//-----------------------------------------------------------------------------

    // Transfer cleaner, TC;
    // finds items in <token>/results folder with no corresponding <token>/sources item
    // locks result item on Redis (use 'token:item:transfer' key template)
    //  if locked, moves result item to target folder, then takes new item in checklist
    // otherwise, simply skips move phase and takes next item in checklist
    // if checklist is over, re-read <token> folders
    // if folders contain no proper items, change script
    
//-----------------------------------------------------------------------------

$(document).ready(function(){
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }

        // time needed to move one item in normal conditions, sec
        
    const keyExpirationTime = 3;
    
        // setup Watchdog stuff
    /*
    var watchDogEntry = new WatchDog(15000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    */
        //
        
    //var token = 'int_train-trainfeed';
    //var targetToken = 'int_train-maintrain';

    var token = 'int_train-maintrain';
    var targetToken = 'int_train-test';

        //
        
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error transferring results to folder ' + entry.args.targetFolder + ' for token ' + entry.args.token + '; stopped.');   
        
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
        
        var resNamesList = Object.keys(resItems);
        var resCount = resNamesList.length;

        for(var i = 0; i < resCount; ++i)
        {
            var name = resNamesList[i];
            
            if(srcItems[name] === undefined)
            {
                checklist.push(name);
            }
        }

        if(checklist.length === 0)
        {
            logInfo('No more unbound results for token ' + entry.args.token + '; stopped.');     
            
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
        var key = entry.args.token + ':' + name + ':transfer';

            // (potential) revision phase will use checklist and randomIndex
        phases[phaseRevision].args.checklist = checklist;    
        phases[phaseRevision].args.randomIndex = randomIndex;
            
            // check Redis key for this entry by Atomically INCrementing 'token:item_name:pair'
            // (also sets key EXpiration time)

        redisPostCommand('aincex', [key, keyExpirationTime], function(response){

            var nextPhaseEntryIndex;
            
            if(response && response.reply && (response.reply === 1))
            {
                    // we are first who touched this item in competition!
                
                nextPhaseEntryIndex = phaseMoving;
                
                    // moving phase will use item name
                    
                phases[phaseMoving].args.name = name;
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
    
    function moveItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var fromPath = entry.args.fromFolder + '/' + entry.args.name;
        var toPath = entry.args.toFolder + '/' + entry.args.name;
        
        logInfo('Moving item ' + fromPath + ' to ' + toPath);
        
        redisPostCommand('YAD_MOVE_ELEMENT', [fromPath, toPath], function(response){
            
            if(response.error)
            {
                    // on error it is better to restart
                
                restart(phases);
            }
            else
            {
                logInfo('Item ' + entry.args.name + ' possibly transferred');
                
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
    var targetFolder = 'workspace/' + targetToken + '/sources';
    
    var sourceItems = {};
    var resultItems = {};
      
    const phaseRandomSelection = 3;
    const phaseMoving = 5;
    const phaseRevision = 6;
    const phaseStopOnError = 7;
    
    var phases = 
    [
    /*0*/   {proc: getList, args: {inFolder: srcFolder, registry: sourceItems}},
    /*1*/   {proc: getList, args: {inFolder: resFolder, registry: resultItems}},
    /*2*/   {proc: createPotentialWorkset, args: {src: sourceItems, res: resultItems, token: token}},
    /*3*/   {proc: randomSelection, args: {token: token}},
    /*4*/   {proc: checkAtomic, args: {token: token}},
    /*5*/   {proc: moveItem, args: {fromFolder: resFolder, toFolder: targetFolder}},
    /*6*/   {proc: reviseItem, args: {}},
    /*7*/   {proc: reportErrorAndStop, args: {token: token, targetFolder: srcFolder}}
    ];
    
    phases[0].proc(phases, 0);
        
});

//-----------------------------------------------------------------------------
