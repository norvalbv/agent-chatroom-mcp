export const PHOTOS_CSS = `
  .photo-tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; min-width:0 }
  .photo-tools:has(#photo-status:empty):has(#photo-preview:empty) { display:none }
  #photo-status { font-size:12px; color:var(--bad); overflow-wrap:anywhere; padding:0 6px } #photo-status:empty { display:none }
  #photo-preview { display:flex; flex-wrap:wrap; gap:8px; width:100% }
  #photo-preview:empty { display:none }
  .photo-preview { display:flex; align-items:center; gap:8px; border-radius:16px; padding:5px 5px 5px 5px; max-width:100%; background:var(--panel) }
  .photo-preview img { width:44px; height:44px; object-fit:cover; border-radius:11px }
  .photo-preview span { max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px }
  .photo-preview .btn { min-height:28px; padding:0 11px; font-size:12px; background:var(--panel2) }
  .photo-images { display:flex; gap:8px; flex-wrap:wrap; padding-top:6px }
  .photo-images a { max-width:100%; display:block; border-radius:16px; overflow:hidden; background:var(--panel) }
  .photo-images img { display:block; max-width:100%; width:240px; max-height:200px; object-fit:cover }
`;

/** The composer's "+" (left of the message box) and the tray above the box for previews and errors. */
export const PHOTOS_BUTTON_HTML = `<button class="btn icon ghost" type="button" id="add-photo" title="Add photos: up to 4, 8 MB each, or paste an image" aria-label="Add photos"><span class="i i-plus"></span></button><input type="file" id="photo-files" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden />`;
export const PHOTOS_TRAY_HTML = `<div class="photo-tools"><span id="photo-status" role="status" aria-live="polite"></span><div id="photo-preview"></div></div>`;

export const PHOTOS_JS = String.raw`
  var photoDrafts = new Map(), photoSending = false;
  function photosFor(room) { if (!photoDrafts.has(room)) photoDrafts.set(room, []); return photoDrafts.get(room); }
  function photoRoomChanged() {
    var root = $('#photo-preview'); root.replaceChildren();
    $('#photo-status').textContent = ''; $('#add-photo').disabled = !sel || photoSending;
    photosFor(sel).forEach(function (photo) {
      var item = document.createElement('div'); item.className = 'photo-preview';
      var img = document.createElement('img'); img.src = photo.preview; img.alt = photo.file.name;
      var name = document.createElement('span'); name.textContent = photo.file.name;
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn'; remove.textContent = 'Remove'; remove.disabled = photoSending;
      remove.setAttribute('aria-label', 'Remove ' + photo.file.name);
      remove.onclick = function () { var list = photosFor(sel), index = list.indexOf(photo); if (index >= 0) list.splice(index, 1); URL.revokeObjectURL(photo.preview); photoRoomChanged(); $('#add-photo').focus(); };
      item.append(img, name, remove); root.appendChild(item);
    });
  }
  function addPhotos(files) {
    if (!sel || photoSending) return;
    var list = photosFor(sel), error = '';
    Array.from(files).forEach(function (file) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { error = 'Choose PNG, JPEG, WebP or GIF photos.'; return; }
      if (!file.size || file.size > 8 * 1024 * 1024) { error = 'Each photo must be smaller than 8 MB.'; return; }
      if (list.length >= 4) { error = 'Send up to 4 photos at a time.'; return; }
      list.push({ file: file, preview: URL.createObjectURL(file), uploaded: null });
    });
    photoRoomChanged(); $('#photo-status').textContent = error;
  }
  $('#add-photo').onclick = function () { $('#photo-files').click(); };
  $('#photo-files').onchange = function (e) { addPhotos(e.target.files); e.target.value = ''; };
  $('#text').addEventListener('paste', function (e) {
    var files = Array.from((e.clipboardData || {}).files || []).filter(function (file) { return file.type.indexOf('image/') === 0; });
    if (files.length) { e.preventDefault(); addPhotos(files); }
  });
  function photoMatches(content) {
    return Array.from(String(content).matchAll(/\[image: (\/attachments\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:png|jpg|webp|gif)) · [^\]\r\n]+\]/g));
  }
  function photoText(content) {
    var text = String(content), matches = photoMatches(content); if (!matches.length) return text;
    matches.forEach(function (match) { text = text.replace(match[0], ''); });
    return text.trim() || 'Photo attachment';
  }
  function photoThumbnails(content) {
    var urls = photoMatches(content);
    if (!urls.length) return '';
    return '<div class="photo-images">' + urls.slice(0, 4).map(function (m, i) { return '<a href="' + m[1] + '" target="_blank" rel="noopener" aria-label="Open photo ' + (i + 1) + ' in a new tab"><img src="' + m[1] + '" alt="Photo attachment ' + (i + 1) + '" loading="lazy" /></a>'; }).join('') + '</div>';
  }
  $('#compose').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!sel || photoSending) return;
    var room = sel, text = $('#text').value, content = text.trim(), pending = photosFor(room).slice(), name = myName();
    if (!content && !pending.length) return;
    photoSending = true; $('#sendbtn').disabled = true; photoRoomChanged();
    try {
      var references = [];
      for (var photo of pending) {
        if (!photo.uploaded) {
          var headers = hdrs(); headers['content-type'] = photo.file.type;
          var upload = await fetch('/rooms/' + encodeURIComponent(room) + '/attachments', { method: 'POST', headers: headers, body: photo.file });
          if (!upload.ok) throw new Error(await upload.text());
          photo.uploaded = await upload.json();
        }
        references.push('[image: ' + photo.uploaded.url + ' · ' + photo.uploaded.path + ']');
      }
      if (references.length) content += (content ? '\n\n' : '') + references.join('\n');
      var res = await fetch('/rooms/' + encodeURIComponent(room) + '/messages', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: name, content: content }) });
      if (!res.ok) throw new Error(await res.text());
      pending.forEach(function (photo) { var list = photosFor(room), index = list.indexOf(photo); if (index >= 0) list.splice(index, 1); URL.revokeObjectURL(photo.preview); });
      if (sel === room && $('#text').value === text) { $('#text').value = ''; $('#text').style.height = ''; }
      $('#hint').className = 'hint'; $('#hint').textContent = ''; // the message itself appears in the transcript
    } catch (error) { $('#hint').className = 'hint bad'; $('#hint').textContent = 'Message not sent: ' + error.message; }
    finally { photoSending = false; $('#sendbtn').disabled = false; photoRoomChanged(); }
    poll();
  });
  photoRoomChanged();
`;
