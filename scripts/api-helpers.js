//-----------------------------------------------------------------------------
function generateUniqueKey(length)
{
    var hexDigits = "0123456789ABCDEF";
    
    if(length === undefined)
    {
        length = 16;
    }
    
    var s = "";
    
    for(var i = 0; i < length; ++i)
    {
        var index = Math.floor(16 * Math.random());
        
        s += hexDigits.charAt(index);
    }
    
    return s;
}
//-----------------------------------------------------------------------------
function dataBufferFromString(s)
{
    var len = s.length;
    
    var dv = new DataView(new ArrayBuffer(len));
    
    for(var i = 0; i < len; ++i)
    {
        dv.setUint8(i, s.charCodeAt(i));
    }
    
    return dv.buffer;
}
//-----------------------------------------------------------------------------
function contentInfo(content)
{
    var contentInfo = {};
    
    if(typeof(content) === 'string')
    {
        contentInfo.queryContentType = 'text';
        contentInfo.transferContentType = 'text/plain';
        contentInfo.dataToTransfer = content;
    }
    else if(ArrayBuffer.isView(content))
    {
        contentInfo.queryContentType = 'bin';
        contentInfo.transferContentType = 'text/plain; charset=x-user-defined';
        contentInfo.dataToTransfer = content.buffer;
    }
    else
    {
        contentInfo.queryContentType = 'json';
        contentInfo.transferContentType = 'application/json';
        contentInfo.dataToTransfer = JSON.stringify(content);
    }
    
    return contentInfo;
}
//-----------------------------------------------------------------------------
function useGlobalTimeout(t)
{
    $.ajaxSetup({timeout: t});    
}
//-----------------------------------------------------------------------------
function AsyncStepsSequencer(items, startIndex, nextIterator)
{
    this.items = items;
    this.index = startIndex;
    
    this.nextIterator = nextIterator;
}

AsyncStepsSequencer.prototype.nextStep = function()
{
    this.index++;
    
    if(this.index < this.items.length)
    {
        this.stepProc();
    }  
    else if(this.nextIterator)
    {
        this.nextIterator.stepProc();
    }
}

Object.defineProperty(AsyncStepsSequencer.prototype, 'currentEntry', {
    get: function(){return this.items[this.index];}    
});

//-----------------------------------------------------------------------------
function AsyncBatch(items, onAllResponded)
{
    this.items = items;    
    this.onAllResponded = onAllResponded;
}

AsyncBatch.prototype.doBatch = function()
{
    var a = this.items;
    var count = a.length;
    
    for(var i = 0; i < count; ++i)
    {
        a[i].responded = undefined;
    }
    
    for(i = 0; i < count; ++i)
    {
        this.slotProc(i);
    }
}

AsyncBatch.prototype.bindSlotCallback = function(f, index)
{
    return f.bind({batch: this, index: index});
}

AsyncBatch.prototype.checkAllResponded = function()
{
    var a = this.items;
    var count = this.items.length;
    
    for(var i = 0; i < count; ++i)
    {
        if(a[i].responded === undefined)
        {
            return;
        }
    }
    
    if(this.onAllResponded)
    {
        this.onAllResponded();
    }
}
//-----------------------------------------------------------------------------