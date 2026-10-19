window.AllsampleFilterControls = class {
  constructor(onChange) {
    this.onChange = onChange;
    this.fields = ['min-duration', 'max-duration', 'min-bpm', 'max-bpm', 'key', 'loop', 'channels', 'redistribution', 'contentId', 'adult', 'modification'];
    for (const id of this.fields) document.getElementById(id).addEventListener('input', () => { this.update(); onChange(); });
    document.getElementById('duration-slider').oninput = event => {
      document.getElementById('max-duration').value = Number(event.target.value) === 600 ? '' : event.target.value;
      this.update(); onChange();
    };
    this.update();
  }
  get() {
    const number = id => { const input = document.getElementById(id); return input.value === '' || !input.validity.valid ? null : Number(input.value); };
    return { minDuration: number('min-duration'), maxDuration: number('max-duration'), minBpm: number('min-bpm'), maxBpm: number('max-bpm'), key: document.getElementById('key').value, loop: document.getElementById('loop').value === '' ? null : document.getElementById('loop').value === 'true', channels: number('channels'), ...Object.fromEntries(['redistribution', 'contentId', 'adult', 'modification'].map(id => [id, document.getElementById(id).checked])) };
  }
  apply(value = {}) {
    const fields = { 'min-duration': value.minDuration, 'max-duration': value.maxDuration, 'min-bpm': value.minBpm, 'max-bpm': value.maxBpm, key: value.key, loop: value.loop, channels: value.channels };
    for (const [id, setting] of Object.entries(fields)) document.getElementById(id).value = setting ?? '';
    for (const id of ['redistribution', 'contentId', 'adult', 'modification']) document.getElementById(id).checked = value[id] === true;
    this.update();
  }
  update() {
    const value = this.get();
    document.getElementById('duration-slider').value = value.maxDuration == null ? 600 : Math.min(600, value.maxDuration);
    document.getElementById('duration-limit').textContent = value.maxDuration == null ? '上限なし' : `${value.maxDuration}秒まで`;
    const count = Object.entries(value).filter(([key, item]) => item != null && item !== '' && (item !== false || key === 'loop') && !(key === 'minDuration' && item === 0)).length;
    document.getElementById('advanced-count').textContent = count ? ` ${count}` : '';
  }
};
