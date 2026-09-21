// Delegate to the document so virtualized reading/live-preview images work
// without retaining detached DOM nodes. Only intercept our mapped local images.
function handleThumbnailClick(event, app, mapping, onError=()=>{}) {
  if(event.button!==0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)return false;
  const img=event.target?.closest?.('img');
  if(!img || !img.closest('.codex-conversation .callout[data-callout="codex-question"]'))return false;
  const embed=img.closest('.internal-embed.image-embed');
  const path=embed?.getAttribute('src');
  if(!path || !Object.values(mapping||{}).some(asset=>asset.path===path))return false;
  const file=app.vault.getAbstractFileByPath(path);
  if(!file || 'children' in file)return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  try { Promise.resolve(app.workspace.getLeaf('tab').openFile(file)).catch(onError); }
  catch(error) { onError(error); }
  return true;
}
module.exports={handleThumbnailClick};
