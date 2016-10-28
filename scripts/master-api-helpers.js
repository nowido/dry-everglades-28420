//-----------------------------------------------------------------------------
function useProgram(proc, onSuccess, onError)
{
    $.ajax({
        url: location.origin + '/?useProgram=true',
        type : 'POST',
        contentType: 'text/plain',
        data: proc.toString(),
        processData: false,
        dataType: 'text',
        success: onSuccess,
        error: onError
    });
}
//-----------------------------------------------------------------------------
function useWorkItem(programId, content, onSuccess, onError)
{
    var ci = contentInfo(content);
    
    var qs = '/?useWorkItem=true&programId=' + programId + '&contentType=' + ci.queryContentType;

    $.ajax({
        url: location.origin + qs,
        type : 'POST',
        contentType: ci.transferContentType,
        data: ci.dataToTransfer,
        processData: false,
        dataType: 'text',
        success: onSuccess,
        error: onError
    });
}
//-----------------------------------------------------------------------------
function waitResult(programId, itemId, onSuccess, onError)
{
    $.ajax({
        type : 'GET',
        data: { waitResult: true, programId: programId, itemId: itemId },
        success: onSuccess,
        error: onError
    });
}
//-----------------------------------------------------------------------------
function removeProgram(programId, onSuccess, onError)
{
    $.ajax({
        type : 'GET',
        data: { removeProgram: true, programId: programId },
        success: onSuccess,
        error: onError
    });
}
//-----------------------------------------------------------------------------