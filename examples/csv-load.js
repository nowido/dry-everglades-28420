//-----------------------------------------------------------------------------

$(document).ready(function(){
    
    var fname;
    
    function logInfo(info)
    {
        $('<p>' + info + '</p>').appendTo(document.body);
    }
    
    function uploadChunks(chunks)
    {
        var lastPointIndex = fname.lastIndexOf('.');
        
        var dbname = (lastPointIndex < 0) ? fname : fname.substring(0, lastPointIndex);
        
        // use app:/data/<dbname>/chunks folder
        
        logInfo('db name: ' + dbname);
        
        function createFolder(phases, phaseEntryIndex)
        {
            var entry = phases[phaseEntryIndex];
            
            redisPostCommand('YAD_CREATE_FOLDER', [entry.args.inFolder, entry.args.phaseFolder], function(response){
                
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
                    logInfo('Created folder app:/' + entry.args.inFolder + '/' + entry.args.phaseFolder);    
                    phases[phaseEntryIndex + 1].proc(phases, phaseEntryIndex + 1);
                }
                
            }, function(xhr, st, er){
                
                logInfo(er);
                phases[phaseStopOnError].proc(phases, phaseStopOnError);
            });
        }
        
        function reportErrorAndStop(phases, phaseEntryIndex)
        {
            var entry = phases[phaseEntryIndex];
            
            logInfo('Error creating database ' + entry.args.dbname + '; stopped.');    
        }
        
        function writeChunk(phases, phaseEntryIndex)
        {
            var entry = phases[phaseEntryIndex];    

            var currentChunkIndex = entry.args.currentChunk;
            var accIndex = entry.args.accIndex;
            
            var chunk = entry.args.chunks[currentChunkIndex];
            
            var chunkSize = chunk.length;
            
                // the item name is built in form <accIndex>-<accIndex + chunkSize - 1>
                
            var itemName = accIndex.toString() + '-' + (accIndex + chunkSize - 1).toString() + '.json';
            
            logInfo('Writing chunk #' + currentChunkIndex + ', ' + itemName);

            redisPostCommand('YAD_CREATE_ITEM', [entry.args.inFolder, itemName, chunk], function(response){
                
                if(response.error)
                {
                    logInfo(JSON.stringify(response.error));
                    phases[phaseStopOnError].proc(phases, phaseStopOnError);
                }
                else if(response.reply)
                {
                    logInfo(JSON.stringify(response.reply));
                    phases[phaseStopOnError].proc(phases, phaseStopOnError);
                }
                else
                {       
                        // if not last, continue with chunks
                        
                    if(currentChunkIndex < entry.args.chunks.length - 1)
                    {
                        entry.args.currentChunk++;
                        entry.args.accIndex += chunkSize;
                        
                        phases[phaseEntryIndex].proc(phases, phaseEntryIndex);    
                    }
                    else
                    {
                        var timeOfUpload = (Date.now() - timeStartedUpload) / 1000;
                        
                        logInfo('All chunks uploaded in ' + Math.ceil(timeOfUpload) + ' sec; now stopped.');
                    }
                }
            }, function(xhr, st, er){
                
                logInfo(er);
                phases[phaseStopOnError].proc(phases, phaseStopOnError);    
            });
        }
        
        const phaseStopOnError = 3;
        
        var phases = 
        [
        /*0*/{proc: createFolder, args: {dbname: dbname, inFolder: 'data', phaseFolder: dbname}},    
        /*1*/{proc: createFolder, args: {dbname: dbname, inFolder: 'data/' + dbname, phaseFolder: 'chunks'}},
        /*2*/{proc: writeChunk, args: {chunks: chunks, currentChunk: 0, accIndex: 0, inFolder: 'data/' + dbname + '/chunks'}},
        /*3*/{proc: reportErrorAndStop, args: {dbname: dbname}}
        ];
        
        var timeStartedUpload = Date.now();
        
        phases[0].proc(phases, 0);
    }
    
    function prepareChunks()
    {
        $('#skipCheckbox').attr('disabled', 'true');
        $('#uploadButton').attr('disabled', 'true');
        
        var skipFirst = $('#skipCheckbox').prop('checked');
        
        var rows = this.rows;
        
        const goodChunkSize = 128 * 1024;
        
        var accChunkSize = 0;
        
        var chunks = [];
        
        var currentChunk = [];
        var currentChunkContentSize = 0;
        
        var lastIndex = rows.length - 1;
        
        for(var i = (skipFirst ? 1 : 0); i < rows.length; ++i)
        {
            // push strings to chunks, while current chunk's length is less than goodChunkSize

            var r = rows[i];
            
            if((currentChunkContentSize > goodChunkSize) || (i === lastIndex))
            {
                accChunkSize += currentChunkContentSize;
                
                // current chunk has overfilled, or no more data;
                //  push chunk into chain ...
                
                chunks.push(currentChunk);
                
                    // ... and prepare new chunk
                    
                if(i !== lastIndex)
                {
                    currentChunk = [];
                    currentChunkContentSize = 0;
                }
            }
            
            currentChunkContentSize += r.length;
            currentChunk.push(r);
        }
        
        logInfo(chunks.length + ' chunk(s) created with average size of ' + Math.floor(accChunkSize / chunks.length) + ' UTF-8 char(s)');
        logInfo('Starting upload ...');
        
        uploadChunks(chunks);
    }
    
    function readCsvData(file)
    {
        var reader = new FileReader();
        
        reader.onload = function(e)
        {
            var content = e.target.result.replace(/,/g, '.').split(/$\n/m);
            
            var rows = [];

            for(var i = 0; i < content.length; ++i)
            {
                var s = content[i].replace(/;/g, ',').replace(/\s/g,'');
                
                if(s.length > 0)
                {
                    rows.push(s);
                }
            }

            logInfo(rows.length + ' line(s) parsed');
            
            const showBlockSize = 5;
            
            var rowsToDisplayFirst = (rows.length > showBlockSize) ? showBlockSize : rows.length;
            var tailSize = rows.length - rowsToDisplayFirst;
            var rowsToDisplayLast = (tailSize > showBlockSize) ? showBlockSize : tailSize;
            
            for(var i = 0; i < rowsToDisplayFirst; ++i)
            {
                logInfo((i + 1) + ' : ' + rows[i]);
            }
            
            if(rowsToDisplayLast)
            {
                logInfo('...');
            }
            
            for(var i = 0; i < rowsToDisplayLast; ++i)
            {
                var absoluteIndex = rows.length - rowsToDisplayLast + i;
                logInfo((absoluteIndex + 1) + ' : ' + rows[absoluteIndex]);
            }
            
            logInfo('&lt end of csv data &gt');
            
            $('<label><input type="checkbox" id="skipCheckbox">skip first row </label><button id="uploadButton">Upload</button>').appendTo(document.body);
            $('#uploadButton').click(prepareChunks.bind({rows: rows}));
        }
        
        reader.readAsText(file);
    }
    
    function onFileSelected()
    {
        $('#openButton').attr('disabled', 'true');
        
        var fob = $('#fileInput')[0].files[0];
        fname = fob.name;    
        var fsize = fob.size;
        
        logInfo(fname + ' (' + fsize + ' bytes) selected');
        
        readCsvData(fob);
    }
    
    function onFileOpen()
    {
        $('#fileInput')[0].click();    
    }
    
    function preparePage()
    {
        $('<input id="fileInput" type="file" accept=".csv" multiple="false" style="display:none">').appendTo(document.body);   
        $('<button id="openButton">Open CSV file ...</button>').appendTo(document.body);  
        
        $('#openButton').on('click', onFileOpen);
        $('#fileInput').on('change', onFileSelected);
    }

    preparePage();
});

//-----------------------------------------------------------------------------