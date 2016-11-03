//-----------------------------------------------------------------------------

    // Processor unit, PU;
    //  reads workspace/token/sources and workspace/token/results,
    //  selects source item wich has no corresponding result, 
    //  processes it (with atomic stuff)
    //  writes result block to results,
    //  restarts reading workspace folders, and so on

//-----------------------------------------------------------------------------

function logInfo(info)
{
    $('<p>' + info + '</p>').appendTo(document.body);
}

//-----------------------------------------------------------------------------

function workerEntry()
{
    
function buildClusters(radius, samples, callbackOnNewCluster)
{
    const epsilon = 0.0001;
    
    var samplesCount = samples.length;
    
    var pointDimension = samples[0].length;
    
    var unclusterizedIndexes = [];
    
    for(var i = 0; i < samplesCount; ++i)
    {
        unclusterizedIndexes.push(i);
    }
    
    var clusters = [];
    
        // helpers

    function distance(p1, p2)
    {
        var s = 0;
        
        for(var i = 0; i < pointDimension; ++i)
        {
            var d = (p1[i] - p2[i]);
            
            s += d * d;
        }
        
        return Math.sqrt(s);
    }
    
    function findNeighbours(center)
    {
        var neighbours = [];
        
        var count = unclusterizedIndexes.length;
        
        for(var i = 0; i < count; ++i)
        {
            var testIndex = unclusterizedIndexes[i];
            
            if(distance(center, samples[testIndex]) < radius)   
            {
                neighbours.push(testIndex);
            }
        }
        
        return neighbours;
    }
    
    function excludeFromClusterization(setOfPoints)
    {
        var newCluster = {points:[]};
        
        var newUnclusterized = [];
        
        var unclusterizedCount = unclusterizedIndexes.length;
        var pointsCount = setOfPoints.length;
        
        for(var i = 0; i < unclusterizedCount; ++i)
        {
            var pointIndex = unclusterizedIndexes[i];
            
            var found = -1;
            
            for(var j = 0; j < pointsCount; ++j)
            {
                if(setOfPoints[j] === pointIndex)
                {
                    found = j;
                    break;
                }
            }
            
            if(found < 0)
            {
                newUnclusterized.push(pointIndex);
            }
            else
            {
                newCluster.points.push(pointIndex);
            }
        }
        
        unclusterizedIndexes = newUnclusterized;
        
        return newCluster;
    }
    
    function calcMassCenter(setOfPoints)
    {
        var count = setOfPoints.length;

        var center = [];
        
        var point = samples[setOfPoints[0]];
        
        for(var i = 0; i < pointDimension; ++i)
        {
            center[i] = point[i];
        }
        
        for(var i = 1; i < count; ++i)
        {
            point = samples[setOfPoints[i]];
            
            for(var j = 0; j < pointDimension; ++j)
            {
                center[j] += point[j];    
            }
        }

        for(var i = 0; i < pointDimension; ++i)
        {
            center[i] /= count;
        }
        
        return center;
    }
    
    function selectRandomCenter()
    {
        var center = [];
        
        var randomIndex = Math.floor(Math.random() * unclusterizedIndexes.length);
        
        var pointSelected = samples[unclusterizedIndexes[randomIndex]];
        
        for(var i = 0; i < pointDimension; ++i)
        {
            center[i] = pointSelected[i];    
        }
        
        return center;
    }
        
        // main FOREL
    do 
    {
        var center = selectRandomCenter();
        
        do
        {
            var neighbours = findNeighbours(center);
            var newCenter = calcMassCenter(neighbours);   
            
            var stabilized = (distance(center, newCenter) < epsilon);
            
            center = newCenter;
        }
        while(!stabilized);
    
        var cluster = excludeFromClusterization(neighbours);
        
        cluster.center = center;

        clusters.push(cluster);
        
        if(callbackOnNewCluster)
        {
            callbackOnNewCluster(cluster);
        }
    }
    while(unclusterizedIndexes.length > 0);
    
        // sort clusters by population (biggest first)
    
    clusters.sort(function(a, b){
        return b.points.length - a.points.length;
    });
    
    return clusters;
}

    onmessage = function(e)
    {
        function callback(cluster)
        {
            postMessage({info: cluster.points.length});
        }
        
        postMessage({clusters: buildClusters(e.data.radius, e.data.samples, callback)}); 
    }
}

//-----------------------------------------------------------------------------

function processingBody(srcContent, callbackOnDone)
{
    // 'footprint' is used in simple transactioning algorithm:
    //  Transfer-Cleaner stage will move-with-same-name-and-with-overwrite any result item back to sources folder;
    //  this leads to condition 'source present && no result present', 
    //  and the source item normally needs processing - but after Transfer-Cleaner we have already processed item
    //  from sources folder, thus processor must recognize its own 'footprint' to avoid processing for such items.
    //  And the reason for move-back operation is that Transfer-Cleaner may move-forward 'footprinted' items
    //  from source folder to next stage. Also, there will be no unbound results in this scheme.
    
    // processed items make pairs {source-result}
    // TC locks a pair, and deletes source - 1 step
    // UC moves unbound results to destination - 1 step
    // OK
    // but: to cycle (feed partially processed items back to source)
    // we need UC which examines each result, and if it is not fully processed, move it to source,
    // otherwise - to destination
    
    const decimalPlaces = 6;
    const radius = 2.2;
    const qFactor = 4;
    const anfisRulesCount = 10;
    const separator = 0;
    const amplitude = 2;
    
    var model = 
    {
        footprint: 'initialized', 
        rulesCount: anfisRulesCount, 
        rangesMin: [], 
        rangesMax: [],
        separator: separator,
        amplitude: amplitude,
        trainSet: [/*normalized*/], 
        parameters: []
    };
    
    // src content is array of records;
    //  each record is an array of fields
    //      each field is floating point number

    var recordsCount = srcContent.length;
    
    if(!recordsCount)
    {
        model.footprint = 'empty';
        
        return model;
    }
    
    var fieldsCount = srcContent[0].length;
    var yIndex = fieldsCount - 1;
    
        // find fields ranges 

    var record = srcContent[0];
    var value;
    
    for(var col = 0; col < yIndex; ++col)
    {
        value = record[col];
        
        model.rangesMin[col] = value;
        model.rangesMax[col] = value;
    }

    for(var row = 1; row < recordsCount; ++row)
    {
        record = srcContent[row];
        
        for(var col = 0; col < yIndex; ++col)
        {
            value = record[col];
            
            var minValue = model.rangesMin[col];
            var maxValue = model.rangesMax[col];
            
            if(minValue > value)
            {
                model.rangesMin[col] = value;    
            }
            
            if(maxValue < value)
            {
                model.rangesMax[col] = value;    
            }
        }
    }
    
        // known Y is {0,1}, we map it to {-amplitude, +amplitude}

    model.rangesMin[yIndex] = -amplitude;
    model.rangesMax[yIndex] = +amplitude;

        // known Y is {0,1}, we map it to {0, +amplitude}
        
    //model.rangesMin[yIndex] = 0;
    //model.rangesMax[yIndex] = amplitude;
    
    var ranges = [];
    
    for(var col = 0; col < fieldsCount; ++col)
    {
        ranges[col] = model.rangesMax[col] - model.rangesMin[col];
    }
    
        // normalize trainSet
    
    for(var row = 0; row < recordsCount; ++row)
    {
        record = srcContent[row];
        
        var recordNormalized = [];
        
        for(var col = 0; col < fieldsCount; ++col)
        {
            var value = record[col];
            
            if(col === yIndex)
            {   
                    // known Y is {0,1}, we map it to {-amplitude, +amplitude}
                    
                value = (value > 0) ? +amplitude : -amplitude;
                
                    // known Y is {0,1}, we map it to {0, +amplitude}
                    
                //value = (value > 0) ? amplitude : 0;
            }
            else
            {
                if(ranges[col] > 0)
                {
                    value = (value - model.rangesMin[col]) / ranges[col];   
                }
                else
                {
                    value = 0;
                }
            }
            
            recordNormalized.push(decimalRound(value, decimalPlaces));
        }
        
        model.trainSet.push(recordNormalized);
    }
    
        // clusterize trainSet

    var workerUrl = URL.createObjectURL(new Blob(["(" + workerEntry.toString() + ")()"], {type: "application/javascript"}));        
    
    var worker = new Worker(workerUrl);
    
    URL.revokeObjectURL(workerUrl);
    
    worker.onmessage = function(e)
    {
        var clusters = e.data.clusters;

        if(clusters)
        {
            worker.terminate();
            
            var clustersCount = clusters.length;
            
            logInfo('Found ' + clustersCount + ' clusters. The biggest cluster contains ' + clusters[0].points.length + ' points');
            
            var s = '';
            
            for(var i = 0; i < clustersCount; ++i)
            {
                s += clusters[i].points.length + ', ';
            }
            
            logInfo(s);
                
                // initialize model parameters
                // a - cluster center, q - qFactor * radius, b = 0, l0 = average y for points in cluster
                
            var parameterIndex = 0;
            
            var parameters = model.parameters;
            
            for(var r = 0; r < anfisRulesCount; ++r)
            {
                var cluster = clusters[r % clustersCount];
                    
                    // a
                for(var col = 0; col < yIndex; ++col)
                {
                    parameters[parameterIndex] = decimalRound(cluster.center[col], decimalPlaces);
                    ++parameterIndex;                    
                }
                    // q
                //var q = decimalRound(qFactor * radius, decimalPlaces);
                var q = decimalRound(qFactor, decimalPlaces);
                
                for(var col = 0; col < yIndex; ++col)
                {
                    parameters[parameterIndex] = q;
                    ++parameterIndex;                    
                }
                    // b
                for(var col = 0; col < yIndex; ++col)
                {
                    parameters[parameterIndex] = 0;
                    ++parameterIndex;                    
                }
                    // linear 0
                    // y center for this cluster    

                parameters[parameterIndex] =  decimalRound(cluster.center[yIndex], decimalPlaces);
                ++parameterIndex;
            }
                
            callbackOnDone(model);
        }
    }
    
    worker.postMessage({radius: radius, samples: model.trainSet});
}

//-----------------------------------------------------------------------------

$(document).ready(function(){
    
        // time needed to do processing of one item in normal conditions, sec
        
    const keyExpirationTime = 10;
    
        // setup Watchdog stuff
    /*
    var watchDogEntry = new WatchDog(15000, function(watchdog){
        
        logInfo('Watchdog ' + watchdog.timeoutId + ' timeout (' + watchdog.timeout + ' msec)');    
    });
    */
        //
        
    var token = 'int_train-trainfeed';
    
        //
        
    function reportErrorAndStop(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Error processing items for token ' + entry.args.token + '; stopped.');   
        
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
            
            if(resItems[name] === undefined)
            {
                checklist.push(name);
            }
        }

        if(checklist.length === 0)
        {
            logInfo('No more unprocessed items for token ' + entry.args.token + '; stopped.');     
            
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
    
    function randomSelection(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var checklist = entry.args.checklist;
        var checkCount = checklist.length;

        if(checkCount === 0)
        {
            // we exhausted checklist (all items we have checked are locked by other threads), change script - or just wait a bit   
            
            logInfo('No more accessible items for token ' + entry.args.token + ' for now; waiting...');
            
            // watchdog restart!
            
            dropOldItemNames(phases);

            setTimeout(function(){
                
                phases[0].proc(phases, 0);
                
            }, Math.floor(Math.random() * keyExpirationTime * 1000));
            
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
        var key = entry.args.token + ':' + name;

            // (potential) revision phase will use checklist and randomIndex
        phases[phaseRevision].args.checklist = checklist;    
        phases[phaseRevision].args.randomIndex = randomIndex;
            
            // check Redis key for this entry by Atomically INCrementing 'token:item_name'
            // (also sets key EXpiration time)

        redisPostCommand('aincex', [key, keyExpirationTime], function(response){

            var nextPhaseEntryIndex;
            
            if(response && response.reply && (response.reply === 1))
            {
                    // we are first who touched this item in competition!
                
                nextPhaseEntryIndex = phaseProcessing;
                
                    // processing phase will use item name
                    
                phases[phaseProcessing].args.name = name;
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
    
    function processItem(phases, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        var name = entry.args.name;
        
        dropOldItemNames(phases);
        
        logInfo('Reading item ' + name);
        
        redisPostCommand('YAD_READ_ITEM', [entry.args.srcFolder, name], function(response){
            
            if(response && response.reply)
            {
                if(response.reply.footprint)
                {
                    // do not process this item
                    
                    logInfo('Skipping footprinted item ' + name);
                    
                    phases[0].proc(phases, 0);
                }
                else
                {
                    logInfo('Processing item ' + name);
                    
                        // process item (async for heavy load) and go to write result phase
                    
                    processingBody(response.reply, function(modelObject){
                        
                        var nextPhaseEntryIndex = phaseWriteResult;
                        
                        phases[nextPhaseEntryIndex].args.resultContent = modelObject;
                        
                        phases[nextPhaseEntryIndex].args.name = name;
                        
                        phases[nextPhaseEntryIndex].proc(phases, nextPhaseEntryIndex);
                    });
                }
            }
            else
            {
                    // on error it is better to restart
                phases[0].proc(phases, 0);
            }
            
        }, function(){
            
                // on error it is better to restart
            phases[0].proc(phases, 0);
        });        
    }
    
    function writeResult(phase, phaseEntryIndex)
    {
        var entry = phases[phaseEntryIndex];
        
        logInfo('Writing result ' + entry.args.name);
        
        // even if any problem occured, we have nothing to do with it - go to next cycle
        
        redisPostCommand('YAD_CREATE_ITEM', [entry.args.resFolder, entry.args.name, entry.args.resultContent], function(response){
            
            // watchdog restart!
            
            phases[0].proc(phases, 0);
            
        }, function(){
            
            // watchdog restart!
            
            phases[0].proc(phases, 0);
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
    const phaseProcessing = 5;
    const phaseRevision = 6;
    const phaseWriteResult = 7;
    const phaseStopOnError = 8;
    
    var phases = 
    [
    /*0*/   {proc: getList, args: {inFolder: srcFolder, registry: sourceItems}},
    /*1*/   {proc: getList, args: {inFolder: resFolder, registry: resultItems}},
    /*2*/   {proc: createPotentialWorkset, args: {src: sourceItems, res: resultItems, token: token}},
    /*3*/   {proc: randomSelection, args: {token: token}},
    /*4*/   {proc: checkAtomic, args: {token: token}},
    /*5*/   {proc: processItem, args: {srcFolder: srcFolder}},
    /*6*/   {proc: reviseItem, args: {}},
    /*7*/   {proc: writeResult, args: {resFolder: resFolder}},
    /*8*/   {proc: reportErrorAndStop, args: {token: token}}
    ];
    
    phases[0].proc(phases, 0);
    
});

//-----------------------------------------------------------------------------
