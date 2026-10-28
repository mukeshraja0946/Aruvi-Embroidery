/**
 * Aruvi Embroidery - Universal Horizontal Scroller Enhancement
 * - Hides scrollbar lines on all browsers (Mobile Chrome/Safari/Desktop)
 * - Enables smooth mouse-wheel & drag scrolling on desktop
 * - Injects sleek left/right navigation arrows on desktop hover
 * - Keeps 100% native swipe & touch-action on mobile
 */
document.addEventListener('DOMContentLoaded', () => {
  initHorizontalScrollers();
});

function initHorizontalScrollers() {
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const scrollers = document.querySelectorAll('.grid-6, .hide-scrollbar, .category-pills-scroll-row, .filter-pills-scroll-row, .thumbnails-scroll-container, .testimonial-cards-wrapper');

  scrollers.forEach((scroller) => {
    // Ensure reusable hide-scrollbar class is applied
    if (!scroller.classList.contains('hide-scrollbar')) {
      scroller.classList.add('hide-scrollbar');
    }

    // 1. Mouse wheel horizontal scrolling for desktop
    scroller.addEventListener('wheel', (e) => {
      // If user is scrolling vertically and the scroller has horizontal overflow
      if (scroller.scrollWidth > scroller.clientWidth) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
          // If at extreme start and scrolling up, or extreme end and scrolling down, let page scroll
          const atStart = scroller.scrollLeft <= 0;
          const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
          if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) {
            return;
          }
          e.preventDefault();
          scroller.scrollLeft += e.deltaY * 0.9;
        }
      }
    }, { passive: false });

    // 2. Drag-to-scroll on desktop
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let moved = false;

    scroller.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      isDown = true;
      moved = false;
      scroller.style.cursor = 'grabbing';
      scroller.style.userSelect = 'none';
      startX = e.pageX - scroller.offsetLeft;
      scrollLeft = scroller.scrollLeft;
    });

    scroller.addEventListener('mouseleave', () => {
      if (isDown) {
        isDown = false;
        scroller.style.cursor = '';
        scroller.style.userSelect = '';
      }
    });

    scroller.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        scroller.style.cursor = '';
        scroller.style.userSelect = '';
      }
    });

    scroller.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - scroller.offsetLeft;
      const walk = (x - startX) * 1.4; // Multiplier
      if (Math.abs(walk) > 4) moved = true;
      scroller.scrollLeft = scrollLeft - walk;
    });

    // Prevent click on children if dragging
    scroller.addEventListener('click', (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    }, true);

    // 3. Desktop Hover Arrow Buttons (Only for non-touch or large desktop rows)
    if (!isTouchDevice && (scroller.classList.contains('grid-6') || scroller.classList.contains('row-with-arrows'))) {
      setupDesktopArrows(scroller);
    }
  });
}

function setupDesktopArrows(scroller) {
  let wrapper = scroller.parentElement;
  if (!wrapper.classList.contains('scroller-wrapper-relative')) {
    // If not already wrapped, wrap or mark
    wrapper.style.position = 'relative';
    wrapper.classList.add('scroller-wrapper-relative');
  }

  // Check if arrows already exist
  if (wrapper.querySelector('.scroller-arrow-btn.prev-arrow')) return;

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'scroller-arrow-btn prev-arrow';
  prevBtn.setAttribute('aria-label', 'Scroll left');
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'scroller-arrow-btn next-arrow';
  nextBtn.setAttribute('aria-label', 'Scroll right');
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';

  wrapper.appendChild(prevBtn);
  wrapper.appendChild(nextBtn);

  function updateArrowState() {
    const hasOverflow = scroller.scrollWidth > scroller.clientWidth + 4;
    if (!hasOverflow) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      return;
    }
    prevBtn.style.display = '';
    nextBtn.style.display = '';

    const atStart = scroller.scrollLeft <= 5;
    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 5;

    prevBtn.style.opacity = atStart ? '0' : '';
    prevBtn.style.pointerEvents = atStart ? 'none' : '';
    nextBtn.style.opacity = atEnd ? '0' : '';
    nextBtn.style.pointerEvents = atEnd ? 'none' : '';
  }

  prevBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const scrollAmount = Math.max(220, scroller.clientWidth * 0.7);
    scroller.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  });

  nextBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const scrollAmount = Math.max(220, scroller.clientWidth * 0.7);
    scroller.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  });

  scroller.addEventListener('scroll', updateArrowState, { passive: true });
  window.addEventListener('resize', updateArrowState);
  setTimeout(updateArrowState, 200);
}
