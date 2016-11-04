//-----------------------------------------------------------------------------

    // Transfer feedback, TF;
    // finds pairs of 'source item : result item' in <token> folder
    // locks pair on Redis (use 'token:item:transfeedback' key template)
    //  if locked, reads result item, checks its footprint for incompleteness;
    //          if incomplete, moves result item to sources folder with overwrite (!)
    //              otherwise (if complete) moves result item (with or without overwrite) to destination folder
    //      then takes new pair in checklist
    // otherwise (if not locked), simply skips pair and takes next in checklist
    // if checklist is over, re-read <token> folders
    // if folders contain no proper items, change script

//-----------------------------------------------------------------------------

function logInfo(info)
{
    $('<p>' + info + '</p>').appendTo(document.body);
}

//-----------------------------------------------------------------------------

function isGarbage(item)
{
    return item.context && (item.context.weird || item.context.diverged || item.context.local);    
}

function isProperToFeedback(item)
{
    return (item.footprint === 'trained') && (item.stepsDone < 3000);
}

//-----------------------------------------------------------------------------

$(document).ready(function(){
    

        // time needed to check one item in normal conditions, sec
        
    const keyExpirationTime = 10;
    
        // setup Watchdog stuff
    /*
    var watchDogEntry = new WatchDog(15000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    */
        //
        
    var token = 'int_train-maintrain';
    var targetToken = 'int_train-test';

        //
        
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error dispatching items for token ' + entry.args.token + '; stopped.');   
        
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
        var key = entry.args.token + ':' + name + ':transfeedback';

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
                
                nextPhaseEntryIndex = phaseExamine;
                
                    // examine phase will use item name
                    
                phases[phaseExamine].args.name = name;
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
    
    function examineItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var srcFolder = entry.args.srcFolder;
        var resFolder = entry.args.resFolder;
        var targetFolder = entry.args.targetFolder;
        
        var name = entry.args.name;
        
        logInfo('Reading item ' + resFolder + '/' + name);
        
        redisPostCommand('YAD_READ_ITEM', [resFolder, name], function(response){
            
            if(response && response.reply)
            {
                var nextPhaseEntryIndex = phaseMoving;
                
                phases[nextPhaseEntryIndex].args.name = name;
                
                var item = response.reply;
                
                if(isGarbage(item))
                {
                    logInfo(name + ' seems improper to further processing; transferring to garbage folder');    
                }
                else if(!isProperToFeedback(item))
                {
                        // do not feedback this item
                    
                    logInfo(name + ' is improper to feedback; transferring to target folder');
                    
                    phases[nextPhaseEntryIndex].args.toFolder = targetFolder;
                    
                    // to do: drop weird, diverged, local items to special garbage folder
                }
                else
                {
                    logInfo(name + ' goes back');

                    phases[nextPhaseEntryIndex].args.toFolder = srcFolder;
                }
                
                phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
            }
            else
            {
                    // on error it is better to skip this item
                phases[phaseRevision].proc(phases, phaseRevision);
            }
            
        }, function(){
            
                // on error it is better to skip this item
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
                logInfo('Error transferring item ' + entry.args.name);
            }
            else
            {
                logInfo('Item ' + entry.args.name + ' possibly transferred');
            }
            
            // watchdog restart!
            
            restart(phases);
            
        }, function(xhr, st, er){
            
                // on error it is better to restart
            logInfo('*Error ' + er);    
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
    var garbageFolder = 'workspace/' + token + '/garbage/bin';
    
    var sourceItems = {};
    var resultItems = {};
      
    const phaseRandomSelection = 3;
    const phaseExamine = 5;
    const phaseMoving = 6;
    const phaseRevision = 7;
    const phaseStopOnError = 8;
    
    var phases = 
    [
    /*0*/   {proc: getList, args: {inFolder: srcFolder, registry: sourceItems}},
    /*1*/   {proc: getList, args: {inFolder: resFolder, registry: resultItems}},
    /*2*/   {proc: createPotentialWorkset, args: {src: sourceItems, res: resultItems, token: token}},
    /*3*/   {proc: randomSelection, args: {token: token}},
    /*4*/   {proc: checkAtomic, args: {token: token}},
    /*5*/   {proc: examineItem, args: {srcFolder: srcFolder, resFolder: resFolder, targetFolder: targetFolder, garbageFolder: garbageFolder}},
    /*6*/   {proc: moveItem, args: {fromFolder: resFolder}},
    /*7*/   {proc: reviseItem, args: {}},
    /*8*/   {proc: reportErrorAndStop, args: {token: token}}
    ];
    
    phases[0].proc(phases, 0);
        
});

//-----------------------------------------------------------------------------
