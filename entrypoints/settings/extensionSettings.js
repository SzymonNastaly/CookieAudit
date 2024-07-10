function initFastModeCheckbox() {
  const checkbox = document.getElementById('fastModeCheckbox');

  // Set initial checkbox state
  storage.getItem('local:settings').then(settings => {
    if (settings == null) {
      checkbox.checked = false;
    } else {
      checkbox.checked = settings.fastMode;
    }
  });

  // Update storage when checkbox changes
  checkbox.addEventListener('change', () => {
    storage.getItem('local:settings').then(settings => {
      if (settings == null) {
        settings = {
          fastMode: checkbox.checked,
        };
      }
      settings.fastMode = checkbox.checked;
      storage.setItem('local:settings', settings);
    });
  });
}

// Call the function when the page loads
document.addEventListener('DOMContentLoaded', initFastModeCheckbox);