//-----------------------------------------------------------------------------

    // Feeder with constraint, FC;
    // writes items with unique names to target folder while it contains less than specified number of items
    //  else changes script

//-----------------------------------------------------------------------------

$(document).ready(function(){

    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
        // setup Watchdog stuff
    
    var watchDogEntry = new WatchDog(20000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });

        //
        
    const dbname = 'int_train';    
    
    var yadb = new Yadb(dbname);
    
    var targetFolder = 'workspace/int_train-trainfeed/sources';
    
    const constraint = 100;
    const outputSetSize = 1000;
    
        //
        
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error accessing target folder: ' + entry.args.phaseFolder + '; stopped.');    
    }
    
    function getTargetFolderElementsCount(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        redisPostCommand('YAD_GET_ITEMS_COUNT', [targetFolder], function(response){
            
            if(response.error)
            {
                logInfo(JSON.stringify(response.error));
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            }
            else if(response.reply.error)
            {
                logInfo(JSON.stringify(response.reply));
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            }
            else
            {
                var itemsCount = response.reply._embedded.total;
                logInfo('Folder ' + entry.args.phaseFolder + ' contains ' + itemsCount + ' items');    
                
                if(itemsCount < entry.args.constraint)
                {
                    phases[phaseEntryIndex + 1].proc(phases, phaseEntryIndex + 1);
                }
                else
                {
                    logInfo('Folder contains too many items; stopped.');
                }
            }
            
        }, function(xhr, st, er){
            
            logInfo(er);
            phases[phaseStopOnError].proc(phases, phaseStopOnError);
        });    
    }
    
    function retrieveFullCollection(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        if(entry.args.done)
        {
            phases[phaseBuildRandom].proc(phases, phaseBuildRandom);
        }
        else
        {
            var yadb = entry.args.yadb;
            
            yadb.retrieveFullCollection(function(response){
                
                if(response.reply)
                {
                    logInfo('Full retrieved; length = ' + response.reply.length);    
                    
                    entry.args.done = true;
                    
                    var nextPhaseEntryIndex = phaseEntryIndex + 1;
                    
                    phases[nextPhaseEntryIndex].args.collection = response.reply;
                    
                    phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
                }
                else
                {
                    // to do: change this behaviour to 'try again'
                    
                    //logInfo(response.error);
                    //phases[phaseStopOnError].proc(phases, phaseStopOnError);
                    phases[phaseEntryIndex].proc(phases, phaseEntryIndex);
                }
                
            }, function(chunksDone, chunksCount, chunkResponded){
                
                logInfo('[' + chunkResponded + ']. Done ' + chunksDone + ' of ' + chunksCount);    
            });  
        }
    }
    
    function prepareCollectionData(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];    
        
        var collection = entry.args.collection;
        var recordsCount = collection.length;
        
        var records0 = [];
        var records1 = [];
        
            // parse strings
        
        for(var i = 0; i < recordsCount; ++i)
        {
            var s = '[' + collection[i] + ']';
            var rec = JSON.parse(s);
            
            var lastIndex = rec.length - 1;
            
            if(rec[lastIndex] === 0)
            {
                records0.push(rec);
            }
            else
            {
                records1.push(rec);
            }
        }
        
        logInfo('Parsed ' + records0.length + ' records y=0 and ' + records1.length + ' records y=1');
            
            //
            
        var halfCount = outputSetSize / 2;
        
        var availableCount0 = records0.length;
        var availableCount1 = records1.length;
        
        var count0 = ((availableCount0 >= halfCount) ? halfCount : availableCount0);
        var count1 = ((availableCount1 >= halfCount) ? halfCount : availableCount1);
            
            //
            
        var nextPhaseEntryIndex = phaseEntryIndex + 1;
        
        phases[nextPhaseEntryIndex].args.records0 = records0;
        phases[nextPhaseEntryIndex].args.records1 = records1;

        phases[nextPhaseEntryIndex].args.count0 = count0;
        phases[nextPhaseEntryIndex].args.count1 = count1;
        
        phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
    }
    
    function buildRandomSet(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];    
        
        var records0 = entry.args.records0;
        var records1 = entry.args.records1;
        
        var count0 = entry.args.count0;
        var count1 = entry.args.count1;
        
        function fillSet(sourceCollection, outputCount)
        {
            var availableCount = sourceCollection.length;
            
            var output = [];
            
            var used = {};    
            
            for(var i = 0; i < outputCount; ++i)
            {
                var randomIndex;
                
                do
                {
                    randomIndex = Math.floor(Math.random() * availableCount);
                }
                while(used[randomIndex]);
                
                used[randomIndex] = true;
                
                output.push(sourceCollection[randomIndex]);
            }
            
            return output;
        }
        
        var output0 = fillSet(records0, count0);
        var output1 = fillSet(records1, count1);
        
        logInfo('Generated ' + output0.length + ' records 0');
        logInfo('Generated ' + output1.length + ' records 1');
        
            // now join subsets (with interleave - N.B. no practical meaning)
        
        var totalSize = count0 + count1;
        
        var outputSet = [];
        
        for(var i = 0; i < totalSize; ++i)
        {
            var rec;
            
            if(i % 2 === 0)
            {
                // take from 0
                
                rec = output0.pop();
                
                if(rec)
                {
                    outputSet.push(rec);    
                }
                else
                {
                        // no 0s left, take from 1    

                    outputSet.push(output1.pop());    
                }
            }
            else 
            {
                // take from 1
                
                rec = output1.pop();
                
                if(rec)
                {
                    outputSet.push(rec);    
                }
                else
                {
                        // no 1s left, take from 0    
                        
                    outputSet.push(output0.pop());    
                }
            }
        }
        
        var jsonStr = JSON.stringify(outputSet);
        
        logInfo('Generated ' + outputSet.length + ' records (' + jsonStr.length + ' UTF-8 chars)');
        
            //
            
        var nextPhaseEntryIndex = phaseEntryIndex + 1;
        
        phases[nextPhaseEntryIndex].args.content = outputSet;

        phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
    }
        
    function writeResult(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
            // generate unique item name and write item to target folder
        
        var itemName = generateUniqueKey() + '.json';
        
        redisPostCommand('YAD_CREATE_ITEM', [entry.args.phaseFolder, itemName, entry.args.content], function(response){
            
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
                logInfo('Result item ' + itemName + ' possibly created (if not, no problem, no valuable data lost)');
                
                //logInfo('Killing watchdog ' + watchDogEntry.timeoutId);
                //watchDogEntry.killWatchDog();

                logInfo('Restarting watchdog for next ' + Math.floor(watchDogEntry.timeout/1000) + ' sec');
                watchDogEntry.restartWatchDog();
                
                phases[0].proc(phases, 0);
            }
            
        }, function(xhr, st, er){
            
            logInfo(er);
            phases[phaseStopOnError].proc(phases, phaseStopOnError);
        });
    }
    
    const phaseBuildRandom = 3;
    const phaseStopOnError = 5;

    var phases = 
    [
    /*0*/{proc: getTargetFolderElementsCount, args: {phaseFolder: targetFolder, constraint: constraint}},  
    /*1*/{proc: retrieveFullCollection, args: {yadb: yadb}},  
    /*2*/{proc: prepareCollectionData, args: {}},  
    /*3*/{proc: buildRandomSet, args: {}},
    /*4*/{proc: writeResult, args: {phaseFolder: targetFolder}},
    /*5*/{proc: reportErrorAndStop, args: {phaseFolder: targetFolder}}
    ];
    
    phases[0].proc(phases, 0);
});

//-----------------------------------------------------------------------------
