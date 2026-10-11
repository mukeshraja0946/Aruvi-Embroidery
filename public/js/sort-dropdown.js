/**
 * ARUVI EMBROIDERY STUDIO — Standardized Sort By Dropdown
 * Handles toggling, option selection, keyboard navigation, outside click,
 * and dispatching form submission or URL navigation.
 */

(function () {
  function initAruviSortDropdowns() {
    const containers = document.querySelectorAll('.aruvi-sort-container');

    containers.forEach(container => {
      if (container.dataset.aruviInitialized) return;
      container.dataset.aruviInitialized = 'true';

      const dropdown = container.querySelector('.aruvi-sort-dropdown');
      if (!dropdown) return;

      const trigger = dropdown.querySelector('.aruvi-sort-trigger');
      const menu = dropdown.querySelector('.aruvi-sort-menu');
      const hiddenInput = container.querySelector('input[type="hidden"]') || container.querySelector('select');
      const options = dropdown.querySelectorAll('.aruvi-sort-option');
      const valueText = trigger ? trigger.querySelector('.aruvi-sort-value-text') : null;
      const iconWrap = trigger ? trigger.querySelector('.aruvi-sort-icon') : null;

      if (!trigger || !menu) return;

      // Toggle dropdown open/close
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = dropdown.classList.contains('open');

        // Close all other open dropdowns
        document.querySelectorAll('.aruvi-sort-dropdown.open').forEach(d => {
          if (d !== dropdown) {
            d.classList.remove('open');
            const trig = d.querySelector('.aruvi-sort-trigger');
            if (trig) trig.setAttribute('aria-expanded', 'false');
          }
        });

        if (isOpen) {
          dropdown.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
        } else {
          dropdown.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
          // Focus the currently selected option or first option
          const selectedOpt = menu.querySelector('.aruvi-sort-option.selected') || options[0];
          if (selectedOpt) {
            selectedOpt.scrollIntoView({ block: 'nearest' });
          }
        }
      });

      // Keyboard navigation on trigger
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (!dropdown.classList.contains('open')) {
            dropdown.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
          }
          const selectedOpt = menu.querySelector('.aruvi-sort-option.selected') || options[0];
          if (selectedOpt) selectedOpt.focus();
        } else if (e.key === 'Escape' && dropdown.classList.contains('open')) {
          e.preventDefault();
          dropdown.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
        }
      });

      // Option selection
      options.forEach(option => {
        option.setAttribute('tabindex', '0');

        function selectThisOption() {
          const val = option.getAttribute('data-value');
          const labelEl = option.querySelector('.aruvi-sort-option-label');
          const optIconEl = option.querySelector('.aruvi-sort-opt-icon');
          const labelText = labelEl ? labelEl.textContent.trim() : option.textContent.trim();

          // Update trigger label and icon
          if (valueText) valueText.textContent = labelText;
          if (iconWrap && optIconEl) {
            iconWrap.innerHTML = optIconEl.innerHTML;
          }

          // Update active class
          options.forEach(opt => {
            opt.classList.remove('selected');
            opt.setAttribute('aria-selected', 'false');
          });
          option.classList.add('selected');
          option.setAttribute('aria-selected', 'true');

          // Close dropdown
          dropdown.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.focus();

          // Update hidden input or select if present
          if (hiddenInput) {
            hiddenInput.value = val;
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
          }

          // Trigger action based on configuration
          const actionType = container.getAttribute('data-action-type');

          if (actionType === 'url') {
            // URL parameter update (preserves other params like category, search, format, page)
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set(container.getAttribute('data-param-name') || 'sort', val);
            // Reset to page 1 on new sort
            if (currentUrl.searchParams.has('page')) {
              currentUrl.searchParams.set('page', '1');
            }
            window.location.href = currentUrl.toString();
          } else if (actionType === 'direct-url') {
            // Direct URL navigation (e.g. if option specifies entire path)
            const targetUrl = option.getAttribute('data-url');
            if (targetUrl) {
              window.location.href = targetUrl;
            } else {
              const currentUrl = new URL(window.location.href);
              currentUrl.searchParams.set('sort', val);
              window.location.href = currentUrl.toString();
            }
          } else if (actionType === 'submit') {
            // Admin form submit
            const form = container.closest('form');
            if (form) {
              // Ensure hidden input is inside form
              if (hiddenInput && !form.contains(hiddenInput)) {
                form.appendChild(hiddenInput);
              }
              form.submit();
            }
          } else {
            // Default check: if inside a form, submit; otherwise update URL search param
            const form = container.closest('form');
            if (form) {
              form.submit();
            } else {
              const currentUrl = new URL(window.location.href);
              currentUrl.searchParams.set('sort', val);
              if (currentUrl.searchParams.has('page')) currentUrl.searchParams.set('page', '1');
              window.location.href = currentUrl.toString();
            }
          }
        }

        option.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          selectThisOption();
        });

        option.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectThisOption();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = option.nextElementSibling;
            if (next && next.classList.contains('aruvi-sort-option')) next.focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = option.previousElementSibling;
            if (prev && prev.classList.contains('aruvi-sort-option')) prev.focus();
            else trigger.focus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            dropdown.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
          }
        });
      });
    });
  }

  // Close when clicking outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.aruvi-sort-dropdown')) {
      document.querySelectorAll('.aruvi-sort-dropdown.open').forEach(d => {
        d.classList.remove('open');
        const trig = d.querySelector('.aruvi-sort-trigger');
        if (trig) trig.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.aruvi-sort-dropdown.open').forEach(d => {
        d.classList.remove('open');
        const trig = d.querySelector('.aruvi-sort-trigger');
        if (trig) trig.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Export to window
  window.initAruviSortDropdowns = initAruviSortDropdowns;

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAruviSortDropdowns);
  } else {
    initAruviSortDropdowns();
  }
})();
