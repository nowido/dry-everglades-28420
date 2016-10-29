//-----------------------------------------------------------------------------

$(document).ready(function(){
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function onError(xhr, st, er)
    {
        logInfo(er);    
    }
    
    // each new worker gets the <token> as hard-coded program-associated UUID    
    //  (simply put, it is the name of folders app:/data/<token>/source and app:/data/<token>/results)
    
    // worker asks yad for two lists of items, corresponded to above stated folders (SF & RF)
    // worker calcs a set 'potential work' PW = SF\RF (sets difference; i.e., ask source items that have no results yet)
    
    // A:
    // if PW = 0, no work, exit
    // else worker generates random entry (let it be file 'it') in PW and sends to Redis incr <token>:it
    //  if Redis returns 1, we are the (potentially, considering key expiration) first, 
    //      now check result: yad-list-elements app:/data/<token>/results/it
    //          if response contains message, the result 'it' is not found, so we can process it
    //              (otherwise we have the situation when previous processor made the result after key expired)
    //  if Redis returns > 1, we are not first who asks 'it', exclude 'it' from PW, and goto A: (repeat the cycle)
    
    // anyway, we need to set key expiration time to the appropriate timeout (depends on task)
    // it is done by the worker who tested all items, and found no work (key > 1 && no_result)
    //  (it can be normal if all the work was successfully distributed among all workers,
    //      but it also may be due to crash of one or more previous job requests after key was incremented to 1)
    // this worker sets key expiration time - and waits for a while, then goto A
    
    var token = 'token1';
    
    const keyExpirationTime = 2;

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
        var inFolder = this.inFolder;
        var registry = this.registry;
           
        redisPostCommand('YAD_LIST_ELEMENTS', [inFolder], function(response){
            
            logInfo(JSON.stringify(response));
            
            if(response && response.reply)
            {
                var itemsCollection = response.reply._embedded.items;
                
                if(itemsCollection === undefined)
                {
                    logInfo('Can not obtain list of items in folder ' + inFolder);    
                    logInfo('Stopped');    
                }
                else
                {
                    createRegistry(itemsCollection, registry);

                    var nextIndex = phaseEntryIndex + 1;
                    phases[nextIndex].proc(phases, nextIndex);
                }
            }
        }, onError);        
    }
    
    function createPotentialWorkset(phases, phaseEntryIndex)
    {
        var resItems = this.res;
        
        var checklist = [];
        
        var srcNamesList = Object.keys(this.src);
        var srcCount = srcNamesList.length;
        
        for(var i = 0; i < srcCount; ++i)
        {
            var name = srcNamesList[i];
            
            if(resItems[name] === undefined)
            {
                checklist.push(name);
            }
        }
        
        if(checklist.length === 0)
        {
            logInfo('No more unprocessed items. Stopped.');        
        }
        else
        {
            var nextIndex = phaseEntryIndex + 1;
            
            phases[nextIndex].checklist = checklist;
            
            phases[nextIndex].proc(phases, nextIndex);
        }
    }
    
    function reviseItem(phase, phaseEntryIndex)
    {
        var randomIndex = this.randomIndex;
        
        var checklist = this.checklist;
        var count = checklist.length;
        
        var newList = [];
        
        for(var i = 0; i < count; ++i)
        {
            if(i !== randomIndex)
            {
                newList.push(checklist[i]);    
            }
        }
        
        phases[3].checklist = newList;
        
        phases[3].proc(phases, 3);
    }
    
    function writeResult(phase, phaseEntryIndex)
    {
        redisPostCommand('YAD_CREATE_ITEM', [this.resFolder, this.name, this.resultContent], function(response){
            
            logInfo(JSON.stringify(response));
                
                // even if any problem occured, we have nothing to do with it - go to next cycle
                            
            phases[0].proc(phases, 0);
            
        }, function(){
            
                // even if any problem occured, we have nothing to do with it - go to next cycle
            phases[0].proc(phases, 0);
        });        
    }
    
    function processingBody(srcContent)
    {
        srcContent.data += '*'; 
        return srcContent;    
    }
    
    function processItem(phase, phaseEntryIndex)
    {
        var name = this.name;
        
        logInfo('Processing item ' + name);
        
            // clear old lists of sources and results
        phase[2].src = phase[0].registry = {};     
        phase[2].res = phase[1].registry = {};    
        
        var nextIndex = 0;
        
        redisPostCommand('YAD_READ_ITEM', [this.srcFolder, name], function(response){
            
            if(response && response.reply)
            {
                // process, and go to writeResult phase
                
                nextIndex = 7;
                
                phases[nextIndex].resultContent = processingBody(response.reply);
                phases[nextIndex].name = name;
            }

            phases[nextIndex].proc(phases, nextIndex);
            
        }, function(){
            
                // on error better restart, go to phase 0
            phases[0].proc(phases, 0);
        });        
    }
    
    function checkAtomic(phase, phaseEntryIndex)
    {
        var randomIndex = this.randomIndex;
        var checklist = this.checklist;
        var name = checklist[randomIndex];
        var key = this.token + ':' + name;
        
        logInfo('checking ' + name);
        
            // (potential) revision phase will use checklist and randomIndex
        phases[6].checklist = checklist;    
        phases[6].randomIndex = randomIndex;
            
            // check Redis key for this entry by atomically incrementing 'token:item_name'
            // (also sets expiration time)

        redisPostCommand('aincex', [key, keyExpirationTime], function(data){
            
            logInfo('current value for ' + name + 'is ' + data.reply);
            
            var nextIndex;
            
            if(data && data.reply && (data.reply === 1))
            {
                    // processing phase will use item name
                phases[5].name = name;
                
                logInfo('can process ' + name);
                
                nextIndex = 5;
            }
            else
            {
                nextIndex = 6;
            }

            phases[nextIndex].proc(phases, nextIndex);
            
        }, function(){
            
                // if network transfer error occurs, it's better skip this entry
                //      (goes to revision)
            phases[6].proc(phases, 6);
        });
    }
    
    function randomSelection(phase, phaseEntryIndex)
    {
        var checklist = this.checklist;
        var checkCount = checklist.length;

        logInfo(checklist);

        if(checkCount === 0)
        {
            // we exhausted checklist, need re-list folders;
            // goto phase 0, but we need a random wait, maybe
                
                // clear old lists of sources and results
            phase[2].src = phase[0].registry = {};     
            phase[2].res = phase[1].registry = {};    

            setTimeout(function(){
                
                phases[0].proc(phases, 0);
                
            }, Math.floor(Math.random() * keyExpirationTime * 1000));
        }
        else
        {
                // generate random entry [0, current checklist length)  
                //  and go to check Redis key stuff
                
            var nextIndex = phaseEntryIndex + 1;

            phases[nextIndex].randomIndex = Math.floor(Math.random() * checkCount);

            logInfo('Random selected index ' + phases[nextIndex].randomIndex + ' (of ' + checkCount + ')');
            
            phases[nextIndex].checklist = checklist;

            phases[nextIndex].proc(phases, nextIndex);
        }
    }
    
    var srcFolder = 'workspace/' + token + '/sources';
    var resFolder = 'workspace/' + token + '/results';
    
    var sourceItems = {};
    var resultItems = {};
    
    var phases = 
    [
    /*0*/    {proc: getList, inFolder: srcFolder, registry: sourceItems},
    /*1*/    {proc: getList, inFolder: resFolder, registry: resultItems},
    /*2*/    {proc: createPotentialWorkset, src: sourceItems, res: resultItems},
    /*3*/    {proc: randomSelection},
    /*4*/    {proc: checkAtomic, token: token},
    /*5*/    {proc: processItem, srcFolder: srcFolder},
    /*6*/    {proc: reviseItem},
    /*7*/    {proc: writeResult, resFolder: resFolder}
    ];
    
    phases[0].proc(phases, 0);
});

//-----------------------------------------------------------------------------