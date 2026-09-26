(() => {
  'use strict';
  const name = document.querySelector('.paper-name');
  const line = document.querySelector('.paper-title-line');
  if (!name || !line) return;

  function fitTitle() {
    const targetWidth = line.getBoundingClientRect().width;
    const currentWidth = name.getBoundingClientRect().width;
    if (!targetWidth || !currentWidth || Math.abs(targetWidth - currentWidth) < .25) return;
    const fontSize = parseFloat(getComputedStyle(name).fontSize);
    name.style.fontSize = `${fontSize * targetWidth / currentWidth}px`;
  }

  fitTitle();
  if (document.fonts) document.fonts.ready.then(fitTitle);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitTitle).observe(line);
  else window.addEventListener('resize', fitTitle);
})();
