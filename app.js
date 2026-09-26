(() => {
  'use strict';
  const data = window.SUPPLEMENT_DATA;
  const core = window.SupplementCore;
  const controllers = new Set();
  const galleryControllers = new Set();
  const cardControllers = new WeakMap();
  const dialog = document.querySelector('#media-dialog');
  const dialogContent = document.querySelector('#dialog-content');
  const paddingCleanups = new WeakMap();
  const layoutCleanups = new WeakMap();
  let dialogPlayer = null;

  function maskPadding(media, asset) {
    const crop = window.PADDING_CROPS?.[asset.src];
    if (!crop) return;
    const update = () => {
      const insets = core.paddingInsets(asset, crop, media.clientWidth, media.clientHeight);
      if (insets) media.style.clipPath = `inset(${insets.map(value => `${value}px`).join(' ')})`;
    };
    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(update);
      resize.observe(media);
      paddingCleanups.set(media, () => resize.disconnect());
    } else {
      window.addEventListener('resize', update);
      paddingCleanups.set(media, () => window.removeEventListener('resize', update));
      requestAnimationFrame(update);
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeExampleLabel(sample) {
    const row = element('div', 'example-row');
    row.append(element('span', 'example-number', sample.exampleLabel || `Ex ${Number(sample.id.slice(8))}`));
    return row;
  }

  function alignComparison(card, scroll, grid, panels, landscape, frameAspect = null, staggered = false) {
    const rectangles = panels.map(({asset}) => window.PADDING_CROPS?.[asset.src] ||
      {x: 0, y: 0, width: asset.width, height: asset.height});
    const columns = staggered ? 4 : landscape ? Math.min(3, panels.length) : panels.length;
    const layoutRectangles = frameAspect ? rectangles.map(() => ({width: frameAspect, height: 1})) : rectangles;
    panels.forEach(({asset, media, panel}, index) => {
      if (staggered) {
        // Eight half-width tracks center three equal panels over four equal panels.
        panel.style.gridColumn = `${index < 3 ? index * 2 + 2 : (index - 3) * 2 + 1} / span 2`;
        panel.style.gridRow = index < 3 ? '1' : '2';
      }
      const crop = rectangles[index];
      const boxWidth = frameAspect || crop.width / crop.height;
      const fit = core.containRect(crop, boxWidth, 1);
      media.style.width = `${asset.width / crop.width * fit.width / boxWidth * 100}%`;
      media.style.height = `${asset.height / crop.height * fit.height * 100}%`;
      media.style.left = `${(fit.x - crop.x / crop.width * fit.width) / boxWidth * 100}%`;
      media.style.top = `${(fit.y - crop.y / crop.height * fit.height) * 100}%`;
      if (frameAspect && window.PADDING_CROPS?.[asset.src]) {
        media.style.clipPath = `inset(${crop.y / asset.height * 100}% ${(asset.width - crop.x - crop.width) / asset.width * 100}% ${(asset.height - crop.y - crop.height) / asset.height * 100}% ${crop.x / asset.width * 100}%)`;
      }
    });
    const update = () => {
      if (!scroll.clientWidth) return;
      const preferred = parseFloat(getComputedStyle(card).getPropertyValue('--stage-height')) || (landscape ? 220 : 320);
      const minimum = landscape ? 125 : 185;
      const plan = core.comparisonLayout(layoutRectangles, columns, scroll.clientWidth, preferred, minimum);
      const tracks = staggered ? Array(8).fill((plan.columnWidths[0] - plan.gap) / 2) : plan.columnWidths;
      grid.style.gridTemplateColumns = tracks.map(width => `${width}px`).join(' ');
      const gridWidth = plan.columnWidths.reduce((total, width) => total + width, 0) + plan.gap * (columns - 1);
      card.style.setProperty('--comparison-width', `${gridWidth}px`);
      panels.forEach(({stage}, index) => {
        stage.style.width = `${plan.widths[index]}px`;
        stage.style.height = `${plan.height}px`;
      });
    };
    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(update);
      resize.observe(scroll);
      layoutCleanups.set(card, () => resize.disconnect());
    } else {
      window.addEventListener('resize', update);
      layoutCleanups.set(card, () => window.removeEventListener('resize', update));
      requestAnimationFrame(update);
    }
  }
  function pauseAll(except) {
    for (const controller of controllers) if (controller !== except) controller.pause();
  }
  function expandMedia(asset, label, isImage) {
    pauseAll();
    document.querySelector('#dialog-title').textContent = label;
    const media = element(isImage ? 'img' : 'video');
    media.src = asset.src;
    if (isImage) media.alt = label;
    else {
      media.controls = !window.PADDING_CROPS?.[asset.src];
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.poster = asset.poster || '';
    }
    dialogContent.replaceChildren(media);
    maskPadding(media, asset);
    if (!isImage && window.PADDING_CROPS?.[asset.src]) {
      media.dataset.src = asset.src;
      media.dataset.duration = asset.duration;
      const controls = makePlaybackControls('expanded video');
      dialogContent.append(controls.playback, controls.status);
      dialogPlayer = new GroupPlayer(dialogContent, [media], controls.playback, controls.status);
    }
    dialog.showModal();
  }
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    if (dialogPlayer) { dialogPlayer.dispose(); dialogPlayer = null; }
    const video = dialogContent.querySelector('video');
    const media = video || dialogContent.querySelector('img');
    if (media) { paddingCleanups.get(media)?.(); paddingCleanups.delete(media); }
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    dialogContent.replaceChildren();
  });

  class GroupPlayer {
    constructor(card, videos, playback, status) {
      this.card = card;
      this.videos = videos;
      this.master = videos[0];
      this.playButton = playback.querySelector('.play-button');
      this.timeline = playback.querySelector('.timeline');
      this.timeLabel = playback.querySelector('.time-label');
      this.speed = playback.querySelector('.speed-select');
      this.status = status;
      this.playing = false;
      this.starting = false;
      this.buffering = false;
      this.loading = null;
      this.loaded = false;
      this.disposed = false;
      this.operation = 0;
      this.duration = Math.min(...videos.map(video => Number(video.dataset.duration)));
      this.timeline.max = String(this.duration);
      this.updateTime(0);
      this.playButton.addEventListener('click', () => this.playing ? this.pause() : this.play());
      playback.querySelector('.restart-button').addEventListener('click', () => this.seek(0));
      this.timeline.addEventListener('input', () => this.updateTime(Number(this.timeline.value), false));
      this.timeline.addEventListener('change', () => this.seek(Number(this.timeline.value)));
      this.speed.addEventListener('change', () => {
        for (const video of this.videos) video.playbackRate = Number(this.speed.value);
      });
      for (const video of videos) {
        video.addEventListener('ended', () => { if (this.playing) this.loop(); });
        video.addEventListener('waiting', () => {
          if (!this.playing || this.starting || this.looping || this.master.currentTime >= this.duration - .1) return;
          this.buffering = true;
          this.playButton.textContent = '…';
          for (const item of this.videos) item.pause();
        });
        video.addEventListener('canplay', () => this.resumeAfterBuffer());
        video.addEventListener('error', () => {
          if (!video.hasAttribute('src') || this.disposed) return;
          this.pause();
          this.status.textContent = 'A video could not be loaded. Please keep the assets folder beside this page and try again.';
          this.status.hidden = false;
        });
      }
      controllers.add(this);
      cardControllers.set(card, this);
    }
    updateTime(time, updateSlider = true) {
      if (updateSlider) this.timeline.value = String(time);
      this.timeLabel.textContent = core.timeText(time, this.duration);
      this.timeline.setAttribute('aria-valuetext', core.timeText(time, this.duration));
    }
    async ensureLoaded() {
      if (this.loaded) return;
      if (this.loading) return this.loading;
      this.status.hidden = true;
      this.loading = Promise.all(this.videos.map(video => new Promise((resolve, reject) => {
        if (video.readyState >= 3) { resolve(); return; }
        const clean = () => {
          clearTimeout(timeout);
          video.removeEventListener('canplay', ready);
          video.removeEventListener('error', error);
        };
        const ready = () => { clean(); resolve(); };
        const error = () => { clean(); reject(new Error('Unable to load video')); };
        const timeout = setTimeout(error, 30000);
        video.addEventListener('canplay', ready);
        video.addEventListener('error', error);
        video.preload = 'auto';
        video.src = video.dataset.src;
        video.load();
      }))).then(() => {
        this.loaded = true;
        this.duration = core.commonDuration(this.videos);
        this.timeline.max = String(this.duration);
        this.updateTime(this.master.currentTime);
      }).finally(() => { this.loading = null; });
      return this.loading;
    }
    async play() {
      pauseAll(this);
      const operation = ++this.operation;
      this.playButton.disabled = true;
      this.playButton.textContent = '…';
      try {
        await this.ensureLoaded();
        if (this.disposed || this.operation !== operation) return;
        const time = this.master.currentTime >= this.duration - .08 ? 0 : this.master.currentTime;
        for (const video of this.videos) {
          if (Math.abs(video.currentTime - time) > .025) video.currentTime = time;
          video.playbackRate = Number(this.speed.value);
        }
        this.starting = true;
        this.playing = true;
        this.playButton.textContent = 'Ⅱ';
        this.playButton.setAttribute('aria-pressed', 'true');
        await Promise.all(this.videos.map(video => video.play()));
        if (this.operation !== operation || !this.playing) return;
        this.starting = false;
        this.tick();
      } catch (error) {
        if (this.disposed || this.operation !== operation) return;
        this.pause();
        this.status.textContent = 'Playback did not start. Click Play to retry, or click a panel to open it individually.';
        this.status.hidden = false;
      } finally {
        if (!this.disposed && this.operation === operation) this.playButton.disabled = false;
      }
    }
    pause() {
      ++this.operation;
      this.playing = false;
      this.starting = false;
      this.buffering = false;
      this.looping = false;
      cancelAnimationFrame(this.frame);
      for (const video of this.videos) video.pause();
      this.playButton.disabled = false;
      this.playButton.textContent = '▶';
      this.playButton.setAttribute('aria-pressed', 'false');
    }
    async seek(value) {
      const resume = this.playing;
      this.pause();
      const operation = this.operation;
      try {
        await this.ensureLoaded();
        if (this.disposed || operation !== this.operation) return;
        const time = core.clampTime(value, this.duration);
        for (const video of this.videos) video.currentTime = time;
        this.updateTime(time);
        if (resume) await this.play();
      } catch (error) {
        this.status.textContent = 'Unable to seek until all videos are loaded. Please try Play again.';
        this.status.hidden = false;
      }
    }
    async resumeAfterBuffer() {
      if (!this.playing || !this.buffering || !this.videos.every(video => video.readyState >= 3)) return;
      this.buffering = false;
      this.playButton.textContent = 'Ⅱ';
      this.starting = true;
      try { await Promise.all(this.videos.map(video => video.play())); }
      catch (error) { if (this.playing) this.pause(); }
      finally { this.starting = false; }
    }
    async loop() {
      if (this.looping || !this.playing) return;
      this.looping = true;
      this.buffering = false;
      for (const video of this.videos) video.currentTime = 0;
      try { await Promise.all(this.videos.map(video => video.play())); }
      catch (error) { if (this.playing) this.pause(); }
      finally { this.looping = false; }
    }
    tick() {
      if (!this.playing || this.disposed) return;
      const time = this.master.currentTime;
      this.updateTime(time);
      if (time >= this.duration - .045 || this.master.ended) this.loop();
      else if (!this.buffering && !this.looping && !this.master.seeking) {
        for (const video of this.videos.slice(1)) {
          if (!video.seeking && Math.abs(video.currentTime - time) > .1) video.currentTime = time;
        }
      }
      this.frame = requestAnimationFrame(() => this.tick());
    }
    dispose() {
      this.pause();
      this.disposed = true;
      layoutCleanups.get(this.card)?.();
      layoutCleanups.delete(this.card);
      for (const video of this.videos) {
        paddingCleanups.get(video)?.();
        paddingCleanups.delete(video);
        video.removeAttribute('src'); video.load();
      }
      controllers.delete(this);
      observer.unobserve(this.card);
    }
  }

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting) cardControllers.get(entry.target)?.pause();
  }, { threshold: 0 });

  function makePlaybackControls(id) {
    const playback = element('div', 'playback');
    const play = element('button', 'play-button', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', `Play or pause all videos in ${id}`);
    play.setAttribute('aria-pressed', 'false');
    const restart = element('button', 'restart-button', '↺');
    restart.type = 'button';
    restart.title = 'Restart all videos';
    restart.setAttribute('aria-label', 'Restart all videos');
    const timeline = element('input', 'timeline');
    timeline.type = 'range';
    timeline.min = '0';
    timeline.max = '5';
    timeline.step = '.01';
    timeline.value = '0';
    timeline.setAttribute('aria-label', `Shared playback position for ${id}`);
    const time = element('span', 'time-label');
    const speed = element('select', 'speed-select');
    speed.setAttribute('aria-label', 'Playback speed');
    for (const value of [.25, .5, 1]) {
      const option = element('option', '', `${value}×`);
      option.value = String(value);
      option.selected = value === 1;
      speed.append(option);
    }
    playback.append(play, restart, timeline, time, speed);
    const status = element('p', 'playback-status');
    status.setAttribute('role', 'status');
    status.hidden = true;
    return { playback, status };
  }

  function makeCard(sample, teaser = false, main = false) {
    const card = element('article', `${teaser ? 'teaser-card' : 'comparison-card'} ${sample.layout}${main ? ' main-comparison-card' : ''}`);
    card.id = sample.id;
    if (teaser) {
      const title = { 1: 'Solo Dance Shorts', 2: 'Duet Dance Shorts', 5: 'Group Dance Video' }[sample.people];
      card.append(element('h3', 'teaser-caption', title));
    }
    card.setAttribute('aria-label', teaser ? sample.title : `${sample.id}, ${sample.people} people`);
    const scroll = element('div', 'media-scroll');
    const grid = element('div', 'media-grid');
    // SCAIL landscape comparisons use a centered 3+4 layout.
    const keys = sample.panelKeys || (teaser ? ['reference', 'driving', 'ours']
      : core.panelKeys(sample, 'all', data.modelOrder));
    const staggered = !teaser && sample.layout === 'landscape' && keys.includes('scail') && keys.length === 7;
    if (staggered) card.dataset.comparisonLayout = '3+4';
    grid.style.setProperty('--columns', keys.length);
    const videos = [];
    const panels = [];
    for (const key of keys) {
      const asset = sample.media[key];
      const label = key === 'reference' ? 'Reference image' : key === 'driving' ? 'Driving video'
        : key === 'gt' ? 'GT video' : data.models[key];
      const panel = element('figure', `media-panel ${key === 'ours' ? 'ours' : ''}`);
      const caption = element('figcaption', 'panel-label', label);
      const stage = element('button', 'media-stage');
      stage.type = 'button';
      stage.setAttribute('aria-label', `Enlarge ${label} — ${teaser ? sample.title : sample.id}`);
      const isImage = key === 'reference';
      const media = element(isImage ? 'img' : 'video');
      media.width = asset.width;
      media.height = asset.height;
      if (isImage) {
        media.src = asset.src;
        media.alt = label;
        media.loading = 'lazy';
        media.decoding = 'async';
      } else {
        media.dataset.src = asset.src;
        media.dataset.duration = asset.duration;
        media.poster = asset.poster;
        media.preload = 'none';
        media.muted = true;
        media.defaultMuted = true;
        media.playsInline = true;
        media.setAttribute('aria-label', label);
        videos.push(media);
      }
      stage.append(media);
      if (teaser) maskPadding(media, asset);
      else panels.push({asset, media, stage, panel});
      stage.addEventListener('click', () => expandMedia(asset, label, isImage));
      panel.append(stage, caption);
      grid.append(panel);
    }
    scroll.append(grid);
    card.append(scroll);
    if (!teaser) {
      const addedOrUpdated = sample.source === 'additional-20260923' ||
        (sample.source === 'group' && sample.media.multianimate) || main;
      const landscape = sample.layout === 'landscape';
      // A fixed 16:9 box gives 832x448 and 832x480 outputs different visible
      // heights. Use the widest visible ratio for 3+4 rows so every source
      // fills the same height without stretching or trimming its content.
      const frameAspect = staggered ? Math.max(...panels.map(({asset}) => {
        const visible = window.PADDING_CROPS?.[asset.src] || asset;
        return visible.width / visible.height;
      })) : addedOrUpdated ? (landscape ? 16 / 9 : 9 / 16) : null;
      if (frameAspect) {
        card.dataset.frameAspect = staggered ? 'shared-height' : landscape ? '16:9' : '9:16';
        card.dataset.frameAspectRatio = String(frameAspect);
      }
      alignComparison(card, scroll, grid, panels, landscape, frameAspect, staggered);
    }
    const { playback, status } = makePlaybackControls(sample.id);
    card.append(playback, status);
    const controller = new GroupPlayer(card, videos, playback, status);
    if (!teaser) card.append(makeExampleLabel(sample));
    if (!teaser) galleryControllers.add(controller);
    observer.observe(card);
    return card;
  }

  function makePeopleGroup(group, open = false, modelOrder = null) {
    const details = element('details', 'people-group');
    details.dataset.people = String(group.people);
    details.open = open;
    const summary = element('summary');
    summary.append(element('span', '', `${group.people} ${group.people === 1 ? 'Person' : 'People'}`),
      element('span', 'group-count', String(group.samples.length)));
    const body = element('div', 'people-group-body');
    const cards = group.samples.map(sample => makeCard(modelOrder ? {...sample, modelOrder} : sample));
    body.append(...cards);
    details.append(summary, body);
    details.addEventListener('toggle', () => {
      if (!details.open) cards.forEach(card => cardControllers.get(card)?.pause());
    });
    return details;
  }

  function renderComparisons() {
    for (const controller of galleryControllers) controller.dispose();
    galleryControllers.clear();
    const configuration = window.QUALI_CURATION;
    const grouped = core.groupSamples(data.samples, configuration);
    const main = document.createDocumentFragment();
    grouped.main.forEach(sample => {
      main.append(makeCard({...sample, modelOrder: configuration.mainModelOrder || sample.modelOrder}, false, true));
    });
    document.querySelector('#main-comparison-list').replaceChildren(main);
    const fragment = document.createDocumentFragment();
    for (const group of grouped.groups) {
      fragment.append(makePeopleGroup(group, false, configuration.additionalModelOrder));
    }
    document.querySelector('#comparison-list').replaceChildren(fragment);
    const baseline = document.createDocumentFragment();
    const baselineCards = grouped.baseline.map(sample => makeCard(sample));
    baseline.append(...baselineCards);
    document.querySelector('#additional-baseline-list').replaceChildren(baseline);
    const baselineSection = document.querySelector('#additional-baseline-section');
    baselineSection.ontoggle = () => {
      if (!baselineSection.open) baselineCards.forEach(card => cardControllers.get(card)?.pause());
    };
    // MotionTwin dataset pairs: GT and driving videos, grouped by the number of people.
    const datasetSamples = (data.datasetSamples || []).map(sample => ({...sample,
      panelKeys: ['gt', 'driving'], exampleLabel: `Sample ${Number(sample.id.slice(-2))}`}));
    const peopleCounts = [...new Set(datasetSamples.map(sample => sample.people))].sort((a, b) => a - b);
    const dataset = document.createDocumentFragment();
    for (const people of peopleCounts) {
      dataset.append(makePeopleGroup({people, samples: datasetSamples.filter(sample => sample.people === people)}));
    }
    document.querySelector('#dataset-list').replaceChildren(dataset);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAll(); });
  window.addEventListener('pagehide', () => pauseAll());
  for (const teaser of data.teasers) document.querySelector('#teaser-grid').append(makeCard(teaser, true));
  renderComparisons();
})();
