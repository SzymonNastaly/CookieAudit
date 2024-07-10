function initCheckbox() {
  const fastModeCheckbox = document.getElementById('fastModeCheckbox');
  const audioCheckbox = document.getElementById('audioCheckbox');

  // Set initial fastModeCheckbox state
  storage.getItem('local:settings').then(settings => {
    if (settings == null) {
      fastModeCheckbox.checked = false;
      audioCheckbox.checked = false;
    } else {
      fastModeCheckbox.checked = settings.fastMode;
      audioCheckbox.checked = settings.enableAudio;
    }
  });

  // Update storage when fastModeCheckbox changes
  fastModeCheckbox.addEventListener('change', () => {
    storage.getItem('local:settings').then(settings => {
      if (settings == null) {
        settings = {
          fastMode: fastModeCheckbox.checked,
        };
      }
      settings.fastMode = fastModeCheckbox.checked;
      storage.setItem('local:settings', settings);
    });
  });

  audioCheckbox.addEventListener('change', () => {
    storage.getItem('local:settings').then(settings => {
      if (settings == null) {
        settings = {
          fastMode: fastModeCheckbox.checked,
          enableAudio: audioCheckbox.checked,
        };
      }
      settings.fastMode = fastModeCheckbox.checked;
      settings.enableAudio = audioCheckbox.checked;
      storage.setItem('local:settings', settings);
    });
  });
}

// Call the function when the page loads
document.addEventListener('DOMContentLoaded', initCheckbox);