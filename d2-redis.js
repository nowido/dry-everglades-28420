//-----------------------------------------------------------------------------
var http = require('http');
var https = require('https');
var url = require('url');
var fs = require("fs");

//-----------------------------------------------------------------------------

var redis = require('redis');

//-----------------------------------------------------------------------------

const redisUrl = '//redis-12559.c10.us-east-1-2.ec2.cloud.redislabs.com:12559';
const redisToken = '123456';

var redisClient;

var redisSubscriber;

var redisSubscriberCommands = 
{
    'SUBSCRIBE' : true,
    'UNSUBSCRIBE' : true,
    'PSUBSCRIBE' : true,
    'PUNSUBSCRIBE' : true
};

var redisExtensionCommands = 
{
    'AINCEX' : true    // Atomic INcrement and Expire; USAGE: AINCEX key, seconds
};

var messagesQueues = {};
var patternMessagesQueues = {};

var atomicIncrementAndExpireScript = 
        "do local v = redis.call('incr',KEYS[1]); if v == 1 then redis.call('expire', KEYS[1], ARGV[1]) end; return v; end";
        
var atomicIncrementAndExpireScriptSHA;

//-----------------------------------------------------------------------------

var yad;

var yadToken = 'AQAAAAAM8pOsAAOMAee8rd1rxUI2sfd1UoI-k7k';
/*
var yadCommands = 
{
    'YAD_CREATE_ITEM' : true,
    'YAD_CREATE_FOLDER' : true,
    'YAD_READ_ITEM' : true,
    'YAD_REMOVE_ELEMENT' : true,
    'YAD_LIST_ELEMENTS' : true,
    'YAD_GET_ITEMS_COUNT' : true
};
*/
//-----------------------------------------------------------------------------

const UncaughtFatalExceptionCode = 1;

//-----------------------------------------------------------------------------

const htmlType = 'text/html';
const textType = 'text/plain';
const jsonType = 'application/json';
const binType = 'text/plain; charset=x-user-defined';

const ctHtml = {'Content-Type': htmlType};
const ctText = {'Content-Type': textType};
const ctTextGz = {'Content-Type': textType, 'Content-Encoding': 'gzip'};
const ctJson = {'Content-Type': jsonType};
const ctBin = {'Content-Type': binType};

const atText = {'Accept': 'text/plain'};
const atJson = {'Accept': 'application/json,text/plain'};

var ctSelector = {};

ctSelector['text'] = ctText;
ctSelector['json'] = ctJson;
ctSelector['bin'] = ctBin;

//-----------------------------------------------------------------------------

const statusOk = 200;

const statusNoContent = 204;
const statusMessageNoContent = 'No Content';

const statusBadRequest = 400;
const statusMessageBadRequest = 'Bad Request';

const statusNotImplemented = 501;
const statusMessageNotImplemented = 'Not Implemented';

//-----------------------------------------------------------------------------

const htmlStartSequence = '<html><script src="jquery.js"></script><script>';
const htmlEndSequence = '</script><body></body></html>';

//-----------------------------------------------------------------------------

const binFileContent = 0;
const textFileContent = 1;

var cachedFiles = 
[
    {mode : binFileContent, path : './jquery/jquery.js.gz'},
    {mode : textFileContent, path : './jquery/jquery.js'},
    {mode : textFileContent, path : './pages/master-submit.html'},
    {mode : textFileContent, path : './pages/slave-wait-injection.html'},
    {mode : textFileContent, path : './scripts/redis-api-helpers.js'}
];

const jqgzip = 0;
const jqnogzip = 1;
const mipage = 2;
const sipage = 3;
const redisapiscript = 4;

//-----------------------------------------------------------------------------

function YadClient(yadToken)
{
    this.yadToken = yadToken;
    
    this.yadAuth = 'OAuth ' + yadToken;

    this.yadApiHeaders = 
    {
        'Authorization': this.yadAuth,
        'Accept' : 'application/json',
        'Content-Type': 'application/json'
    };

    this.yadHost = 'https://cloud-api.yandex.net';    
    this.pathPrefix = 'app:/';
}

YadClient.prototype.executeCommand = function(command, commandArgs, callback)
{
    var commandEntry = this.commandsRegistry[command];

    if(commandEntry)
    {
        var proc = commandEntry.proc;
        var numArgs = commandEntry.numArgs;
        
        var restrictedArgs = commandArgs.slice(0, numArgs);
        
        restrictedArgs.push(callback);

        proc.apply(this, restrictedArgs);
    }
    else
    {
        var errJSON = '{"error":' + '"' + command + ' is not a Yad command"}';
        
        callback(errJSON, null);
    }
}

YadClient.prototype.createFolder = function(folder, name, callback)
{
    var postfix = (folder !== "") ? (folder + "/" + name) : name;
    
    this.reqHelperPut(this.yadHost + '/v1/disk/resources/?path=app:/' + postfix, this.yadApiHeaders, null, function(err, reply){

        callback(err, reply);    
    });
}

YadClient.prototype.createItem = function(folder, itemId, content, callback)
{
    var postfix = (folder !== "") ? (folder + "/" + itemId) : itemId;
    
        // obtain URL for upload
        
    this.reqHelperGet(this.yadHost + '/v1/disk/resources/upload/?path=app:/' + postfix, this.yadApiHeaders, function(err, reply){
        
        if(err)
        {
            callback(err); 
        }
        else if(reply)
        {
            var replyObject = JSON.parse(reply);
            
            if(replyObject.href === undefined)
            {
                callback(err, reply); 
            }
            else
            {
                    // upload content
                    
                this.reqHelperPut(replyObject.href, ctJson, content, function(err, reply){

                    callback(err, reply);    
                });
            }
        }
    }.bind(this));
}

YadClient.prototype.readItem = function(folder, itemId, callback)
{
    var postfix = (folder !== "") ? (folder + "/" + itemId) : itemId;
    
        // obtain URL for download
    
    this.reqHelperGet(this.yadHost + '/v1/disk/resources/download/?path=app:/' + postfix, this.yadApiHeaders, function(err, reply){
        
        if(err)
        {
            callback(err); 
        }
        else if(reply)
        {
            var replyObject = JSON.parse(reply);

            if(replyObject.href === undefined)
            {
                callback(reply, null); 
            }
            else
            {
                    // download content
                    
                this.reqHelperGet(replyObject.href, atJson, function(err, reply){

                    callback(err, reply);    
                });
            }
        }
    }.bind(this));
}

YadClient.prototype.removeElement = function(path, callback)
{
    this.reqHelperDelete(this.yadHost + '/v1/disk/resources/?path=app:/' + path + '&permanently=true', this.yadApiHeaders, function(err, reply){
        
        callback(err, reply);    
    });
}

YadClient.prototype.listElements = function(path, callback)
{
    var fields = '&fields=_embedded.items.name,name';
    
    this.reqHelperGet(this.yadHost + '/v1/disk/resources/?path=app:/' + path + fields, this.yadApiHeaders, function(err, reply){
        
        callback(err, reply);    
    });
}

YadClient.prototype.getItemsCount = function(path, callback)
{
    var fields = '&fields=_embedded.total';
    
    this.reqHelperGet(this.yadHost + '/v1/disk/resources/?path=app:/' + path + fields, this.yadApiHeaders, function(err, reply){
        
        callback(err, reply);    
    });
}

YadClient.prototype.readScript = function(name, callback)
{
    this.reqHelperGet(this.yadHost + '/v1/disk/resources/download/?path=app:/scripts/' + name, this.yadApiHeaders, function(err, reply){
        
        if(err)
        {
            callback(err); 
        }
        else if(reply)
        {
            var replyObject = JSON.parse(reply);

            if(replyObject.href === undefined)
            {
                callback(reply); 
            }
            else
            {
                    // download content
                    
                this.reqHelperGet(replyObject.href, atText, function(err, reply){

                    callback(err, reply);    
                });
            }
        }
    }.bind(this));
}

YadClient.prototype.commandsRegistry = 
{
    'YAD_CREATE_ITEM' : {proc: YadClient.prototype.createItem, numArgs: 3},
    'YAD_CREATE_FOLDER' : {proc: YadClient.prototype.createFolder, numArgs: 2},
    'YAD_READ_ITEM' : {proc: YadClient.prototype.readItem, numArgs: 2},
    'YAD_REMOVE_ELEMENT' : {proc: YadClient.prototype.removeElement, numArgs: 1},
    'YAD_LIST_ELEMENTS' : {proc: YadClient.prototype.listElements, numArgs: 1},
    'YAD_GET_ITEMS_COUNT' : {proc: YadClient.prototype.getItemsCount, numArgs: 1}
};

YadClient.prototype.reqHelper = function(method, reqUrl, headers, content, callback)
{
    var parsedUrl = url.parse(reqUrl);
    
    var req = https.request({
        hostname: parsedUrl.hostname, 
        path: parsedUrl.path,
        method: method,
        headers: headers
    });
    
    req.once('error', function(e){
        callback(e, null);
    });
    
    req.once('response', function(res){
        asyncReadTextStream(res, function(content){
            callback(null, content);    
        });
    });
    
    if(content)
    {
        var strToWrite;
        
        if(typeof(content) === 'string')
        {
            strToWrite = content;
        }
        else
        {
            // content is object, need stringify (double work, by the way - lately it was parsed from command argument...)
            
            strToWrite = JSON.stringify(content);
        }
        
        req.write(strToWrite);    
    }
    
    req.end();
}

YadClient.prototype.reqHelperGet = function(reqUrl, headers, callback)
{
    this.reqHelper('GET', reqUrl, headers, null, callback);
}

YadClient.prototype.reqHelperPut = function(reqUrl, headers, content, callback)
{
    this.reqHelper('PUT', reqUrl, headers, content, callback);
}

YadClient.prototype.reqHelperDelete = function(reqUrl, headers, callback)
{
    this.reqHelper('DELETE', reqUrl, headers, null, callback);
}

function obtainYad(responseToClient)
{
    // got from yandex: {"token_type": "bearer", "access_token": "AQAAAAAM8pOsAAOMAee8rd1rxUI2sfd1UoI-k7k", "expires_in": 31536000}
    
    var host = 'oauth.yandex.ru';

    console.log('getYad ' + host);
    
    // we must obtain code first (do not forget)
    
    var data = 'grant_type=authorization_code&code=1523159&client_id=316bd01e644a4d92b757a4db40c6aa5b&client_secret=cb6bce73c1ed45fa92419f8621f2b1bc';
    
    var req = https.request({
        
        host: host, 
        path: '/token',
        method: 'POST',    
        headers: 
        {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(data)
        }        
    });
    
    req.once('error', function(e){
        
        console.log(e);
        
        response(responseToClient, statusBadRequest, ctText, statusMessageBadRequest);
    });
    
    req.once('response', function(res){
        
        console.log('Got response');
        console.log(res.headers);
        console.log(res.statusCode);
        
        asyncReadTextStream(res, function(content){
            
            response(responseToClient, statusOk, ctHtml, content);    
        });
    });
    
    req.write(data);
    req.end();
}

//-----------------------------------------------------------------------------

function asyncReadTextStream(stream, callbackOnDone)
{
  	stream.once('error', function(e){
  	   callbackOnDone("");
  	});
  	
	var content = "";
	
	stream.on('data', function(chunk){
		
        content += chunk;
	});

	stream.once('end', function(){		
	  
		stream.removeAllListeners('data');		
		  
		callbackOnDone(content);
	});		
}

function asyncReadTextFile(path, callbackOnDone)
{
    asyncReadTextStream(fs.createReadStream(path), callbackOnDone);
}

function asyncReadBinaryStream(stream, callbackOnDone)
{
  	stream.once('error', function(e){
  	   callbackOnDone(null);
  	});

	var contentChunks = [];
	var length = 0;
	
	stream.on('data', function(chunk){
		    
	  length += chunk.length;
	  contentChunks.push(chunk);
	});

	stream.once('end', function(){		
	  
	  stream.removeAllListeners('data');		
	  
	  callbackOnDone(Buffer.concat(contentChunks, length));
	});		
}

function asyncReadBinaryFile(path, callbackOnDone)
{
  	asyncReadBinaryStream(fs.createReadStream(path), callbackOnDone)
}

//-----------------------------------------------------------------------------

function response(responseEntry, code, headers, content)
{
    responseEntry.writeHead(code, headers);
    
    responseEntry.end(content);
}

//-----------------------------------------------------------------------------

function redisSendCommand(command, commandArgs, res)
{
    console.log(command + ' ' + commandArgs);

    try
    {
        var connection = redisSubscriberCommands[command] ? redisSubscriber : redisClient;

        connection.send_command(command, commandArgs, function(err, reply){

            response(res, statusOk, ctJson, JSON.stringify({error : err, reply : reply}));
        });
    }
    catch(e)
    {
        console.log(e);    
        
        response(res, statusBadRequest, ctText, statusMessageBadRequest);
    }
}

//-----------------------------------------------------------------------------

function redisExecuteExtensionCommand(command, commandArgs, res)
{
    // now we have only one extension command: 'AINCEX'
    
    redisClient.send_command('evalsha', [atomicIncrementAndExpireScriptSHA, 1, commandArgs[0], commandArgs[1]], function(err, reply){

        response(res, statusOk, ctJson, JSON.stringify({error : err, reply : reply}));
    });
}

//-----------------------------------------------------------------------------

function notifyResponse(registry, key, eventInfo)
{
    var info = JSON.stringify(eventInfo);
    
    var queue = registry[key];
    
    if(queue !== undefined)
    {
            // there are some ajax requests waiting this message
        
        while(queue.length > 0)
        {
                // to do: what about content type?
            response(queue.pop(), statusOk, ctJson, info);
        }
        
        delete registry[key];
    }
    else
    {
        // no one waits this message with ajax request;
        //  store event info in Redis
        
        redisClient.send_command('LPUSH', [key, info], function(err, reply){
            
            if(err)
            {
                console.log('Redis error while accessing msg queue: ' + err);
            }
            else
            {
                console.log('enqueued: ' + key + ' | ' + info);    
            }
        });
    }
}

//-----------------------------------------------------------------------------

function subscriberOnMessage(channel, message)
{
    console.log('mes: ' + channel + ' | ' + message);    
    
    notifyResponse(messagesQueues, channel, {channel: channel, message: message});
}

function subscriberOnPatternMessage(pattern, channel, message)
{
    console.log('mes: ' + pattern + ' | ' + channel + ' | ' + message);    
    
    notifyResponse(patternMessagesQueues, pattern, {pattern: pattern, channel: channel, message: message});
}

//-----------------------------------------------------------------------------

function enqueueResponse(registry, key, responseEntry)
{
    var queue = registry[key];
    
    if(queue === undefined)
    {
        queue = registry[key] = [];
    }
    
    queue.push(responseEntry);
}

//-----------------------------------------------------------------------------

function dispatchMessageRequest(registry, key, responseEntry)
{
    redisClient.send_command('RPOP', [key], function(err, reply){
        
        if(reply === null)
        {
                // no stored messages for this key, enqueue response
            enqueueResponse(registry, key, responseEntry);
        }
        else if(reply) // it means, no error with Redis
        {
                // there are stored messages, response immediately   
            response(responseEntry, statusOk, ctJson, reply);    
        }
        else
        {
            console.log('Redis error while accessing msg queue: ' + err);
        }
    });
}

//-----------------------------------------------------------------------------

function prepareInjectionPage(responseEntry)
{
    // select random script from from yad/scripts
    // construct page and send to slave
    
        // get list of all scripts in a folder yad/scripts 
    
    yad.listElements('scripts', function(err, reply){
        
        if(reply)
        {
            var replyObject = JSON.parse(reply);
            
            if(replyObject.message)
            {   
                response(responseEntry, statusNoContent, ctText, statusMessageNoContent);
            }
            else
            {
                var items = replyObject._embedded.items;
                var count = items.length;
                
                    // get random script name
                    
                var randomIndex = Math.floor(Math.random() * count);    
                var randomName = items[randomIndex].name;
                
                    // issue yad.readScript(name)
                
                yad.readScript(randomName, function(err, reply){
                    
                    if(reply)
                    {
                            // construct injection page
                        var pageContent = 
                                htmlStartSequence + 
                                cachedFiles[redisapiscript].content + '\n' +
                                reply + '\n' +
                                htmlEndSequence;
                        
                        response(responseEntry, statusOk, ctHtml, pageContent);        
                    }
                    else
                    {
                        response(responseEntry, statusNoContent, ctText, statusMessageNoContent);    
                    }
                });    
            }
        }
        else
        {
            response(responseEntry, statusBadRequest, ctText, statusMessageBadRequest);
        }
    });
}

//-----------------------------------------------------------------------------

function proceedQuery(query, res)
{
    if(query.waitMessage)
    {
        dispatchMessageRequest(messagesQueues, query.channel, res);
    }
    else if(query.waitPatternMessage)
    {
        dispatchMessageRequest(patternMessagesQueues, query.pattern, res);
    }
    else if(query.waitInjection)
    {
        prepareInjectionPage(res);
    }
    else
    {
        response(res, statusBadRequest, ctText, statusMessageBadRequest);
    }
}

function proceedPostedBlock(query, req, res)
{
    if(query.useMi)
    {
        asyncReadTextStream(req, function(postedContent){
            
            var pageContent = 
                htmlStartSequence + 
                cachedFiles[redisapiscript].content + '\n' +
                postedContent + 
                htmlEndSequence;
            
            response(res, statusOk, ctHtml, pageContent);    
        });
    }
    else if(query.sendCommand)
    {
        asyncReadTextStream(req, function(postedContent){
            
            var command = query.command.toUpperCase();
            var commandArgs = JSON.parse(postedContent);
            
            if(YadClient.prototype.commandsRegistry[command])
            {
                yad.executeCommand(command, commandArgs, function(err, reply){
                    
                    var jsonReply = '{"error":';
                    
                    jsonReply += err ? err : 'null';
                    jsonReply += ',"reply":';
                    jsonReply += reply ? reply : 'null';
                    
                    jsonReply += '}';

                    response(res, statusOk, ctJson, jsonReply);
                });    
            }
            else if(redisExtensionCommands[command])
            {
                redisExecuteExtensionCommand(command, commandArgs, res);
            }
            else
            {
                redisSendCommand(command, commandArgs, res);
            }
        });
    }
    else
    {
        response(res, statusBadRequest, ctText, statusMessageBadRequest);
    }
}

//-----------------------------------------------------------------------------

function startServer()
{
    http.createServer(function(req, res){
        
        var parsedRequest = url.parse(req.url, true);
        
        var path = parsedRequest.path;
        
        if(req.method === 'GET')
        {
            if(path === '/jquery.js')
            {
                var ae = req.headers['accept-encoding'];

                if(ae.match(/\bgzip/i))
                {
                    response(res, statusOk, ctTextGz, cachedFiles[jqgzip].content);
                }
                else
                {
                    response(res, statusOk, ctText, cachedFiles[jqnogzip].content);    
                }
            }
            else if(path === '/master')
            {
                response(res, statusOk, ctHtml, cachedFiles[mipage].content);
            }
            else if(path.length < 2)
            {
                response(res, statusOk, ctHtml, cachedFiles[sipage].content);
            }
            else
            {
                proceedQuery(parsedRequest.query, res);
            }
        }
        else if(req.method === 'POST')
        {
            proceedPostedBlock(parsedRequest.query, req, res);
        }
        else
        {
            response(res, statusNotImplemented, ctText, statusMessageNotImplemented);
        }
    }).listen(process.env.PORT);
    
    console.log("Server running at http://" + process.env.IP + ":" + process.env.PORT);    
}

function failServerInitialization()
{
    console.log('Failed to start server, exiting...');      
}

//-----------------------------------------------------------------------------

function asyncCacheFiles(reqs, onDone, onFail){
    
    reqs.map(function(entry){
        
        var actualReadFunc = (entry.mode === 0) ? 
            asyncReadBinaryFile : 
                asyncReadTextFile;
        
       actualReadFunc(entry.path, function(content){
            
            if(content)
            {
                console.log('cached: ' + this.path + ' (' + content.length + ' bytes)');
            }
            
            this.content = content;  
            this.done = true; 
            
            var countDone = 0;
            var allOk = true;
            
            reqs.map(function(e){
                
                countDone += (e.done ? 1 : 0);
                
                allOk = e.content ? allOk : false;
            });
            
            if(countDone === reqs.length)
            {
                if(allOk)
                {
                    onDone();
                }    
                else
                {
                    console.log('Failed to precache files:');
                    
                    reqs.map(function(f){
                        
                        if(!f.content)
                        {
                            console.log(f.path);
                        }
                    });
                    
                    onFail();
                }
            }
            
        }.bind(entry));
    });
}

//-----------------------------------------------------------------------------

function doAbnormalExit()
{
    if(redisClient)
        redisClient.quit();
        
    if(redisSubscriber)    
        redisSubscriber.quit();

    process.exit(UncaughtFatalExceptionCode);
}

//-----------------------------------------------------------------------------

yad = new YadClient(yadToken);

//-----------------------------------------------------------------------------

redisClient = redis.createClient(redisUrl);

redisClient.auth(redisToken, function(err, reply){
    
    if(err)
    {
        console.log('Redis auth failed: ' + reply);
    }
    else
    {
        console.log('Redis auth: ' + reply);
        
        redisClient.on('error', function (err){
            
            console.log('Redis error: ' + err);
            
            doAbnormalExit();
        });
        
        function redisStuff(err, reply)
        {
            if(err)
            {
                console.log('Client duplication error: ' + err);
                
                doAbnormalExit();
            }
            else
            {
                redisSubscriber.on('message', subscriberOnMessage);
                redisSubscriber.on('pmessage', subscriberOnPatternMessage);
                
                // obtain SHA for script
                
                redisClient.send_command('script', ['load', atomicIncrementAndExpireScript], function(err, reply){
                    
                    if(err)
                    {
                        console.log('Can not cache Redis script: ' + err);
                        
                        doAbnormalExit();
                    }
                    else
                    {
                        atomicIncrementAndExpireScriptSHA = reply;
                        
                        console.log('Redis extension ' + atomicIncrementAndExpireScriptSHA);
                                                
                        asyncCacheFiles(cachedFiles, startServer, failServerInitialization);                
                    }
                });
            }
        }

        redisSubscriber = redisClient.duplicate();

        redisSubscriber.auth(redisToken, redisStuff);
    }
});

//-----------------------------------------------------------------------------