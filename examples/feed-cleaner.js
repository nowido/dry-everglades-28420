//-----------------------------------------------------------------------------

    // Feed cleaner, FC;
    // finds pairs of 'source item : result item' in <token> folder
    // locks pair on Redis (use 'token:item:pair' key template)
    //  if locked, deletes sources item, then takes new pair in checklist
    // otherwise, simply skips delete phase and takes next pair in checklist
    // if checklist is over, re-read <token> folders
    // if folders contain no proper pairs, change script
    
//-----------------------------------------------------------------------------

$(document).ready(function(){
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }

        // time needed to delete one item in normal conditions, sec
        
    const keyExpirationTime = 3;
    
        // setup Watchdog stuff
    /*
    var watchDogEntry = new WatchDog(15000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    */
        //
        
    //var token = 'int_train-trainfeed';
    var token = 'int_train-maintrain';

        //
        
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error cleaning sources folder (' + entry.args.inFolder + ') for token ' + entry.args.token + '; stopped.');   
        
        // no need killing watchdog, just change script
    }

    function createRegistry(srcCollection, destRegistry)
    {
        var count = srcCollection.length;
        
        for(var i = 0; i < count; ++i)
        {
            destRegistry[srcCollection[i].name] = true;
        }
    }
    
    function getList(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var inFolder = entry.args.inFolder;
        var registry = entry.args.registry;
        
        logInfo('Reading folder ' + inFolder);
           
        redisPostCommand('YAD_LIST_ELEMENTS', [inFolder], function(response){
            
            if(response.error)
            {
                logInfo(JSON.stringify(response.error));
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            }
            else if(response.reply && response.reply.error)
            {
                logInfo(JSON.stringify(response.reply));
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            }
            else
            {
                var itemsCollection = response.reply._embedded.items;
                
                createRegistry(itemsCollection, registry);

                phases[phaseEntryIndex + 1].proc(phases, phaseEntryIndex + 1);
            }
        }, function(xhr, st, er){
            
            logInfo(er);
            phases[phaseStopOnError].proc(phases, phaseStopOnError);
        });        
    }
    
    function createPotentialWorkset(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var srcItems = entry.args.src;
        var resItems = entry.args.res;
        
        var checklist = [];
        
        var srcNamesList = Object.keys(srcItems);
        var srcCount = srcNamesList.length;
        
        for(var i = 0; i < srcCount; ++i)
        {
            var name = srcNamesList[i];
            
            if(resItems[name] !== undefined)
            {
                checklist.push(name);
            }
        }

        if(checklist.length === 0)
        {
            logInfo('No more used source items for token ' + entry.args.token + '; stopped.');     
            
            // no need killing watchdog, just change script
        }
        else
        {
            var nextPhaseEntryIndex = phaseEntryIndex + 1;
            
            phases[nextPhaseEntryIndex].args.checklist = checklist;
            
            phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
        }
    }
      
    function dropOldItemNames(phases)
    {
            // clear old lists of sources and results
            
        phases[2].args.src = phases[0].args.registry = {};     
        phases[2].args.res = phases[1].args.registry = {};    
    }
    
    function restart(phases)
    {
        // watchdog restart!
        
        dropOldItemNames(phases);

        setTimeout(function(){
            
            phases[0].proc(phases, 0);
            
        }, Math.floor(Math.random() * keyExpirationTime * 1000));
    }
    
    function randomSelection(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var checklist = entry.args.checklist;
        var checkCount = checklist.length;

        if(checkCount === 0)
        {
            // we exhausted checklist (all items we have checked are locked by other threads), change script - or just wait a bit   
            
            logInfo('No more accessible items for token ' + entry.args.token + ' for now; waiting...');
            
            restart(phases);
        }
        else
        {
                // generate random number in [0, current checklist length)  
                //  and go to check Redis key stuff
                
            var nextPhaseEntryIndex = phaseEntryIndex + 1;

            phases[nextPhaseEntryIndex].args.randomIndex = Math.floor(Math.random() * checkCount);

            phases[nextPhaseEntryIndex].args.checklist = checklist;

            phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
        }
    }

    function checkAtomic(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var randomIndex = entry.args.randomIndex;
        var checklist = entry.args.checklist;
        
        var name = checklist[randomIndex];
        var key = entry.args.token + ':' + name + ':pair';

            // (potential) revision phase will use checklist and randomIndex
        phases[phaseRevision].args.checklist = checklist;    
        phases[phaseRevision].args.randomIndex = randomIndex;
            
            // check Redis key for this entry by Atomically INCrementing 'token:item_name:pair'
            // (also sets key EXpiration time)

        redisPostCommand('aincex', [key, keyExpirationTime], function(response){

            var nextPhaseEntryIndex;
            
            if(response && response.reply && (response.reply === 1))
            {
                    // we are first who touched this items pair in competition!
                
                nextPhaseEntryIndex = phaseDeleting;
                
                    // deleting phase will use item name
                    
                phases[phaseDeleting].args.name = name;
            }
            else
            {
                nextPhaseEntryIndex = phaseRevision;
            }

            phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
            
        }, function(){
            
                // if network transfer error occurs, it's better skip this entry
                //      (goes to revision of checklist)
            phases[phaseRevision].proc(phases, phaseRevision);
        });
    }
    
    function deleteItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var path = entry.args.srcFolder + '/' + entry.args.name;
        
        logInfo('Deleting item ' + path);
        
        redisPostCommand('YAD_REMOVE_ELEMENT', [path], function(response){
            
            if(response.error)
            {
                    // on error it is better to restart
                
                restart(phases);
            }
            else
            {
                logInfo('Item ' + path + ' possibly deleted');
                
                // watchdog restart!
                
                phases[phaseEntryIndex + 1].proc(phases, phaseEntryIndex + 1);
            }
            
        }, function(){
            
                // on error it is better to restart
                
            restart(phases);
        });        
    }
    
    function reviseItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var randomIndex = entry.args.randomIndex;
        
        var checklist = entry.args.checklist;
        var count = checklist.length;
        
        var newList = [];
        
        for(var i = 0; i < count; ++i)
        {
            if(i !== randomIndex)
            {
                newList.push(checklist[i]);    
            }
        }
        
        phases[phaseRandomSelection].args.checklist = newList;
        
        phases[phaseRandomSelection].proc(phases, phaseRandomSelection);
    }
    
        //
        
    var srcFolder = 'workspace/' + token + '/sources';
    var resFolder = 'workspace/' + token + '/results';
    
    var sourceItems = {};
    var resultItems = {};
      
    const phaseRandomSelection = 3;
    const phaseDeleting = 5;
    const phaseRevision = 6;
    const phaseStopOnError = 7;
    
    var phases = 
    [
    /*0*/   {proc: getList, args: {inFolder: srcFolder, registry: sourceItems}},
    /*1*/   {proc: getList, args: {inFolder: resFolder, registry: resultItems}},
    /*2*/   {proc: createPotentialWorkset, args: {src: sourceItems, res: resultItems, token: token}},
    /*3*/   {proc: randomSelection, args: {token: token}},
    /*4*/   {proc: checkAtomic, args: {token: token}},
    /*5*/   {proc: deleteItem, args: {srcFolder: srcFolder}},
    /*6*/   {proc: reviseItem, args: {}},
    /*7*/   {proc: reportErrorAndStop, args: {token: token, inFolder: srcFolder}}
    ];
    
    phases[0].proc(phases, 0);
        
});

//-----------------------------------------------------------------------------
