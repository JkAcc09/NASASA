/* o2-model.js — Settings > "Walk budget: oxygen model": the user's own oxygen numbers, or a whole model.
 *
 * Two kinds of model, both MODELLED:
 *   From effort (metabolic)  oxygen follows the work done: standing metabolism, extra per m/s walked, climbing.
 *                            The default model is this kind, with the numbers in BUDGET in config.js.
 *   Fixed rates              oxygen is used at one rate while walking and another while standing, as a suit's
 *                            datasheet might quote them.
 * A field left blank takes the default. Nothing is used until it is saved, and a saved model is marked wherever its
 * numbers show ("your oxygen model"). "Use the defaults" removes it; the defaults themselves are never changed.
 * Kept with the other settings in the browser (marswalk.settings.v1, o2Model), and as a file to share:
 *   { "format": "marswalk-o2-model", "version": 1, "model": "metabolic", "name": "…", "o2Kg": 0.7, … }
 */
(function () {
  'use strict';
  var Bu = MW.budget, settings = MW.settings, $ = MW.geo.$, esc = MW.geo.escapeHtml, kind = 'metabolic';

  function apply() { Bu.setModel(settings.get('o2Model')); status(); }
  function status() {
    var m = settings.get('o2Model');
    $('o2-status').innerHTML = m ? '<span class="dtag o2-yours">YOUR MODEL</span> In use: <b>' + esc(m.name) + '</b> (' + (m.model === 'fixed' ? 'fixed rates' : 'from effort') + ')' +
        (m.savedAt ? ', saved ' + new Date(m.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '. The oxygen readouts say "your oxygen model".'
      : '<span class="dtag">DEFAULT</span> In use: the default model (from effort, with the numbers in BUDGET in config.js).';
  }
  function fields() {
    var m = settings.get('o2Model') || {}, box = $('o2-fields');
    box.innerHTML = Bu.FIELDS.filter(function (f) { return !f.model || f.model === kind; }).map(function (f) {
      var v = m.model === kind || !f.model ? m[f.key] : undefined, d = f.def();
      return '<label class="o2-field"><span>' + f.label + ' <i>' + f.unit + '</i></span>' +
        '<input type="number" inputmode="decimal" data-o2="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + (v === undefined || v === null ? '' : v) + '" placeholder="default ' + (+d.toFixed(3)) + '">' +
        '<small data-o2-err="' + f.key + '"></small></label>';
    }).join('');
    $('o2-name').value = m.name || '';
    Array.prototype.forEach.call(document.querySelectorAll('#o2-kind button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-o2-kind') === kind); });
  }
  function read() {
    var m = { model: kind, name: $('o2-name').value.trim() || 'My oxygen model' };
    Array.prototype.forEach.call(document.querySelectorAll('#o2-fields input[data-o2]'), function (i) { m[i.getAttribute('data-o2')] = i.value; });
    return m;
  }
  function say(t) { $('o2-msg').textContent = t || ''; $('o2-msg').hidden = !t; }
  function showErrors(errs) {
    Array.prototype.forEach.call(document.querySelectorAll('#o2-fields [data-o2-err]'), function (s) {
      var e = errs[s.getAttribute('data-o2-err')] || ''; s.textContent = e;
      s.parentNode.querySelector('input').setAttribute('aria-invalid', !!e);
    });
  }
  function save(m) {
    var v = Bu.validate(m); showErrors(v.errors);
    if (!v.ok) { say('Not saved: check the fields marked in red.'); return false; }
    var out = v.model; out.savedAt = new Date().toISOString();
    settings.set('o2Model', out);
    say('Saved. The walk budget now uses ' + out.name + '.'); return true;
  }

  $('o2-kind').addEventListener('click', function (e) { var b = e.target.closest('[data-o2-kind]'); if (!b) return; kind = b.getAttribute('data-o2-kind'); fields(); showErrors({}); say(''); });
  $('o2-save').addEventListener('click', function () { save(read()); });
  $('o2-reset').addEventListener('click', function () { settings.set('o2Model', null); kind = 'metabolic'; fields(); showErrors({}); say('Your model is removed: the default model is in use again.'); });
  $('o2-export').addEventListener('click', function () {
    var v = Bu.validate(read()); showErrors(v.errors); if (!v.ok) { say('Fix the fields marked in red first.'); return; }
    var data = Object.assign({ format: 'marswalk-o2-model', version: 1 }, v.model), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = (v.model.name || 'oxygen-model').replace(/[^\w\-]+/g, '-').toLowerCase() + '.marswalk-o2.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });
  $('o2-import').addEventListener('click', function () { $('o2-file').click(); });
  $('o2-file').addEventListener('change', function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    if (f.size > 100000) { say('That file is too large to be an oxygen model.'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var d; try { d = JSON.parse(String(rd.result)); } catch (e) { d = null; }
      if (!d || d.format !== 'marswalk-o2-model') { say('That is not a Marswalk oxygen model file (.marswalk-o2.json).'); return; }
      kind = d.model === 'fixed' ? 'fixed' : 'metabolic';
      if (save(d)) { fields(); say('Imported and saved: ' + (d.name || 'oxygen model') + '.'); }
    };
    rd.readAsText(f);
  });
  $('o2-fields').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(read()); } });
  settings.onChange(function () { var m = settings.get('o2Model'); Bu.setModel(m); status(); });

  kind = (settings.get('o2Model') || {}).model === 'fixed' ? 'fixed' : 'metabolic';
  fields(); apply();
  MW.o2Model = { save: save, read: read, apply: apply };
})();
