//-----------------------------------------------------------------------------
// Slave part

function workerEntry(programId)
{
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function onError(xhr, st, er)
    {
        logInfo(er);    
    }
    
    logInfo('Hello, I am worker on ' + programId);

    useGlobalTimeout(2000);

    function onWorkItemReceived(item, status, xhr)
    {
            // item is object with fields: a, b
        logInfo('Job: ' + xhr.status);    
        
        if(xhr.status === 204)
        {
            logInfo('No more job');    
        }
        else
        {
            logInfo('Job: ' + this.key + ' {' + item.a + ', ' + item.b + '}');
            
            var result = item.a + item.b;
            
            useResult(programId, this.key, {result : result}, function(status){
                
                logInfo('OK sent: ' + this.key);
                
                askJob();
                
            }.bind(this), onError);
        }
    }

    function onAskJobFailed(xhr, st, er)
    {
        logInfo(xhr.status + ': ' + st + ' | ' + er);     
    }

    function askJob()
    {
        var entry = {};

        entry.key = generateUniqueKey();
        
        logInfo('Asking job ' + entry.key);
        
        askWorkItem
        (
            programId, 
            entry.key, 
            onWorkItemReceived.bind(entry), 
            onAskJobFailed.bind(entry)
        );
    }
    
    askJob();
}

//-----------------------------------------------------------------------------
// Master part

$(document).ready(function(){
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function onError(xhr, st, er)
    {
        logInfo(er);    
    }
    
    useGlobalTimeout(5000);
    
    useProgram(workerEntry, function(programId){
                
        logInfo('programId = ' + programId);    
        
        const N = 10;
        
        var tasks = [];

        for(var i = 0; i < N; ++i)
        {
            var entry = {a : i, b : i + 1};
            tasks.push(entry);
        }
        
            // send them one-by-one and wait results

        var lastPhase = {};
        
        lastPhase.stepProc = function()
        {
                    // all done, remove program
            
            logInfo('Removing program...');
            
            removeProgram(programId, function(removalStatusMessage){
                
                logInfo('removal status: ' + removalStatusMessage);    
                
            }, onError);    
        };
        /*   
            //
        var iteratorWaitResults = new AsyncStepsSequencer(tasks, 0, lastPhase);
        
            iteratorWaitResults.stepProc = function()
            {
                var entry = this.currentEntry;
                
                if(entry.failed)
                {
                    this.nextStep();
                }
                else
                {
                    logInfo('waiting result for item ' + entry.id);
    
                    waitResult(programId, entry.id, this.stepDone.bind(this), this.stepFailed.bind(this));
                }
            };
            
            iteratorWaitResults.stepDone = function(data, status, xhr)
            {
                var entry = this.currentEntry;
                
                if(xhr.status === 200)
                {
                    entry.result = data.result;
                    
                    logInfo('item ' + entry.id + ' result ' + entry.result); 
                }
                else
                {
                    entry.failed = true;
                }
                
                this.nextStep();
            };
            
            iteratorWaitResults.stepFailed = function(xhr, status, er)
            {
                this.currentEntry.failed = true;    
                
                this.nextStep();
            };
         
            //        
        var iteratorSendItems = new AsyncStepsSequencer(tasks, 0, iteratorWaitResults);
        
            iteratorSendItems.stepProc = function()
            {
                logInfo('sending item...'); 
                
                useWorkItem(programId, this.currentEntry, this.stepDone.bind(this), this.stepFailed.bind(this));
            };
        
            iteratorSendItems.stepDone = function(data, status, xhr)
            {
                if(xhr.status === 200)
                {
                    this.currentEntry.id = data;
                    
                    logInfo('item sent: ' + data); 
                }
                else
                {
                    this.currentEntry.failed = true;
                    
                    logInfo('item failed: ' + data); 
                }
                
                this.nextStep();
            };
            
            iteratorSendItems.stepFailed = function(xhr, status, er)
            {
                this.currentEntry.failed = true;

                this.nextStep();
            };
        
            //
        iteratorSendItems.stepProc();
        */
        
        var batchWaitItems = new AsyncBatch(tasks, lastPhase.stepProc);
        
            batchWaitItems.slotProc = function(index)
            {
                var entry = this.items[index];

                if(entry.failed)
                {
                    entry.responded = true;
                    
                    this.checkAllResponded();
                }
                else
                {
                    logInfo('waiting result for item ' + entry.id);
    
                    waitResult
                    (
                        programId, 
                        entry.id, 
                        this.bindSlotCallback(this.slotDone, index),
                        this.bindSlotCallback(this.slotFailed, index)
                    );
                }
            }
            
            batchWaitItems.slotDone = function(data, status, xhr)
            {
                var batch = this.batch;
                var entry = batch.items[this.index];
                
                if(xhr.status === 200)
                {
                    entry.failed = false; 
                    
                    entry.result = data.result;
                    
                    logInfo('item ' + entry.id + ' result ' + entry.result); 
                }
                else
                {
                    entry.failed = true;
                }
                
                entry.responded = true;
                
                batch.checkAllResponded();
            }
        
            batchWaitItems.slotFailed = function(xhr, status, er)
            {
                var batch = this.batch;
                var entry = batch.items[this.index];
                
                entry.failed = true;    
                
                entry.responded = true;
                
                batch.checkAllResponded();
            }
        
        var batchSendItems = new AsyncBatch(tasks, function(){batchWaitItems.doBatch();});
        
            batchSendItems.slotProc = function(index)
            {
                var entry = this.items[index];
                
                useWorkItem
                (
                    programId, 
                    entry, 
                    this.bindSlotCallback(this.slotDone, index),
                    this.bindSlotCallback(this.slotFailed, index)
                );    
            }
            
            batchSendItems.slotDone = function(data, status, xhr)
            {
                var batch = this.batch;
                var entry = batch.items[this.index];
                
                if(xhr.status === 200)
                {
                    entry.id = data;
                    
                    entry.failed = false;
                    
                    logInfo('item sent: ' + data); 
                }
                else
                {
                    entry.failed = true;
                    
                    logInfo('item failed: ' + data); 
                }
                
                entry.responded = true;
                
                batch.checkAllResponded();
            }

            batchSendItems.slotFailed = function(xhr, status, er)
            {
                var batch = this.batch;
                var entry = batch.items[this.index];
                
                entry.failed = true;
                
                entry.responded = true;
                
                batch.checkAllResponded();
            }
        
            //
        batchSendItems.doBatch();
        
    }, onError);    
});
//-----------------------------------------------------------------------------