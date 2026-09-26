(function (root) {
  'use strict';
  const core = {
    panelKeys(sample, model, order) {
      const methods = model === 'all' ? (sample.modelOrder || order) : [model, 'ours'];
      const keys = ['reference', 'driving', ...new Set(methods.filter(key => sample.media[key]))];
      // With SCAIL, landscape rows place inputs + Ours above their four baselines.
      if (model === 'all' && sample.layout === 'landscape' && keys.includes('scail')) {
        const order = ['reference', 'driving', 'ours', 'multianimate', 'wan-animate-2', 'scail', 'scail2'];
        return [...order.filter(key => keys.includes(key)), ...keys.filter(key => !order.includes(key))];
      }
      return keys;
    },
    commonDuration(videos) {
      const durations = videos.map(video => video.duration).filter(value => Number.isFinite(value) && value > 0);
      return durations.length ? Math.min(...durations) : 0;
    },
    clampTime(value, duration) {
      return Math.max(0, Math.min(Number.isFinite(value) ? value : 0, Math.max(0, duration - .025)));
    },
    timeText(time, duration) {
      return `${Math.max(0, time || 0).toFixed(1)} / ${(duration || 0).toFixed(1)} s`;
    },
    paddingInsets(asset, crop, boxWidth, boxHeight) {
      if (!boxWidth || !boxHeight) return null;
      const scale = Math.min(boxWidth / asset.width, boxHeight / asset.height);
      const offsetX = (boxWidth - asset.width * scale) / 2;
      const offsetY = (boxHeight - asset.height * scale) / 2;
      return [offsetY + crop.y * scale,
        boxWidth - offsetX - (crop.x + crop.width) * scale,
        boxHeight - offsetY - (crop.y + crop.height) * scale,
        offsetX + crop.x * scale].map(value => Math.max(0, value));
    },
    comparisonLayout(rectangles, columns, availableWidth, preferredHeight, minimumHeight, gap = 10) {
      const ratios = rectangles.map(rect => rect.width / rect.height);
      const columnRatios = Array.from({length: columns}, (_, column) =>
        Math.max(...ratios.filter((_, index) => index % columns === column)));
      const height = Math.max(minimumHeight, Math.min(preferredHeight,
        (availableWidth - gap * (columns - 1)) / columnRatios.reduce((a, b) => a + b, 0)));
      return {height, columnWidths: columnRatios.map(ratio => ratio * height),
        widths: ratios.map(ratio => ratio * height), gap};
    },
    containRect(rectangle, boxWidth, boxHeight) {
      const scale = Math.min(boxWidth / rectangle.width, boxHeight / rectangle.height);
      const width = rectangle.width * scale, height = rectangle.height * scale;
      return {x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height};
    },
    groupSamples(samples, configuration) {
      const byId = new Map(samples.map(sample => [sample.id, sample]));
      const used = new Set();
      const main = configuration.mainSampleIds.map(id => {
        if (!id || used.has(id) || !byId.has(id)) return null;
        used.add(id);
        return byId.get(id);
      });
      const baseline = configuration.additionalBaselineIds
        .filter(id => byId.has(id) && !used.has(id)).map(id => byId.get(id));
      baseline.forEach(sample => used.add(sample.id));
      const allowed = Array.isArray(configuration.additionalSampleIds) ? new Set(configuration.additionalSampleIds) : null;
      const peopleCounts = [...new Set([1, 2, 3, 4, 5, ...samples.map(sample => sample.people)])]
        .filter(people => Number.isInteger(people) && people > 0).sort((a, b) => a - b);
      const groups = peopleCounts.map(people => ({people,
        samples: samples.filter(sample => sample.people === people && !used.has(sample.id) && (!allowed || allowed.has(sample.id)))}))
        .filter(group => !allowed || group.samples.length);
      return {main, baseline, groups};
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.SupplementCore = core;
})(typeof window === 'undefined' ? this : window);
