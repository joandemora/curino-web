// assets/js/marketplace-report.js
//
// Modal compartido para reportar piezas. Usado por:
// - Card de pieza en BIBLIOTECA del configurador (icono ⚠️)
// - Modal de compra del configurador (link "Reportar pieza")

window.MarketplaceReport = (function() {
  let _supabase = null;
  let _currentItem = null;

  function init(supabaseClient) {
    _supabase = supabaseClient;
    if (!document.getElementById('mp-report-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'mp-report-modal-styles';
      style.textContent = `
.mp-report-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000;
  display: flex; align-items: center; justify-content: center;
}
.mp-report-modal {
  background: #fff; padding: 24px; border-radius: 8px; max-width: 480px; width: 90%;
  font-family: system-ui, sans-serif;
}
.mp-report-modal h3 { margin: 0 0 12px; font-size: 18px; }
.mp-report-modal p { margin: 0 0 16px; color: #666; font-size: 14px; }
.mp-report-modal label { display: block; margin: 12px 0 4px; font-weight: 500; font-size: 13px; }
.mp-report-modal select, .mp-report-modal textarea {
  width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
  font-family: inherit; font-size: 14px; box-sizing: border-box;
}
.mp-report-modal textarea { min-height: 80px; resize: vertical; }
.mp-report-modal .mp-report-error { color: #c00; font-size: 13px; margin-top: 8px; min-height: 18px; }
.mp-report-modal .mp-report-buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.mp-report-modal button {
  padding: 8px 16px; border: 0; border-radius: 4px; cursor: pointer; font-size: 14px;
}
.mp-report-modal .mp-report-cancel { background: #eee; color: #333; }
.mp-report-modal .mp-report-submit { background: #000; color: #fff; }
.mp-report-modal .mp-report-submit:disabled { opacity: 0.5; cursor: not-allowed; }
`;
      document.head.appendChild(style);
    }
  }

  function open(item) {
    _currentItem = item;
    if (!_supabase) {
      alert('Sistema de reports no inicializado');
      return;
    }

    // Verificar auth
    _supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        alert('Debes iniciar sesión para reportar una pieza');
        return;
      }
      _renderModal();
    });
  }

  function _renderModal() {
    const overlay = document.createElement('div');
    overlay.className = 'mp-report-overlay';
    overlay.innerHTML = `
      <div class="mp-report-modal">
        <h3>Reportar pieza</h3>
        <p>Reportarás <strong>${_escapeHtml(_currentItem.name)}</strong>. Un administrador revisará el report.</p>
        <label for="mp-report-reason">Motivo</label>
        <select id="mp-report-reason">
          <option value="">Selecciona un motivo</option>
          <option value="copyright">Infracción de copyright</option>
          <option value="inappropriate">Contenido inapropiado</option>
          <option value="incorrect_info">Información incorrecta</option>
          <option value="other">Otro motivo</option>
        </select>
        <label for="mp-report-details">Detalles <span style="color:#999;font-weight:normal">(opcional, obligatorio si "Otro")</span></label>
        <textarea id="mp-report-details" maxlength="1000" placeholder="Explica brevemente el motivo..."></textarea>
        <div class="mp-report-error" id="mp-report-error"></div>
        <div class="mp-report-buttons">
          <button class="mp-report-cancel">Cancelar</button>
          <button class="mp-report-submit" disabled>Enviar report</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const reasonSel = overlay.querySelector('#mp-report-reason');
    const detailsTa = overlay.querySelector('#mp-report-details');
    const submitBtn = overlay.querySelector('.mp-report-submit');
    const cancelBtn = overlay.querySelector('.mp-report-cancel');
    const errorDiv = overlay.querySelector('#mp-report-error');

    function validate() {
      const reason = reasonSel.value;
      const details = detailsTa.value.trim();
      if (!reason) { submitBtn.disabled = true; return; }
      if (reason === 'other' && !details) { submitBtn.disabled = true; return; }
      submitBtn.disabled = false;
    }

    reasonSel.addEventListener('change', validate);
    detailsTa.addEventListener('input', validate);

    cancelBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      errorDiv.textContent = '';
      try {
        const { data, error } = await _supabase.rpc('submit_report', {
          p_item_id: _currentItem.id,
          p_reason: reasonSel.value,
          p_details: detailsTa.value.trim() || null
        });
        if (error) throw error;
        overlay.remove();
        alert('Report enviado. Gracias por avisarnos.');
      } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('already_reported')) {
          errorDiv.textContent = 'Ya has reportado esta pieza.';
        } else if (msg.includes('cannot_report_own_item')) {
          errorDiv.textContent = 'No puedes reportar tu propia pieza.';
        } else if (msg.includes('details_required')) {
          errorDiv.textContent = 'Si seleccionas "Otro", debes detallar el motivo.';
        } else {
          errorDiv.textContent = 'Error al enviar. Inténtalo de nuevo.';
          console.error('submit_report error:', err);
        }
        submitBtn.disabled = false;
      }
    });
  }

  function _escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  return { init, open };
})();
