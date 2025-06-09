(() => {
  window.bhpx_sendPixel = (endpoint, payload, onSuccess, onFailure) => {
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]),
    }).then((response) => {
      if (response.ok) {
        onSuccess();
      } else {
        onFailure();
      }
    });
  };

  function monitorUrlChanges(onUrlChange) {
    // Save references to the original methods
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    // Create a custom event to detect history changes
    function triggerUrlChangeEvent() {
      const event = new Event('bhpx:urlchange');
      window.dispatchEvent(event);
    }

    // Override history.pushState
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      triggerUrlChangeEvent(); // Trigger the custom event
    };

    // Override history.replaceState
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      triggerUrlChangeEvent(); // Trigger the custom event
    };

    // Listen for popstate event
    window.addEventListener('popstate', () => {
      triggerUrlChangeEvent(); // Trigger the custom event
    });

    // Listen for the custom bhpx:urlchange event
    window.addEventListener('bhpx:urlchange', onUrlChange);
  }

  const swarmUrls = ['app.beehiiv.com', 'app.staginghiiv.com', 'app-test.staginghiiv.com', 'app.localhiiv.com'];

  // Check if the current URL matches any of the swarm URLs
  // only monitor URL changes if not on a swarm URL
  const isSwarmUrl = swarmUrls.some((url) => window.location.hostname.includes(url));
  if (!isSwarmUrl) {
    // start monitoring url changes and send pageview event
    monitorUrlChanges(() => {
      window.bhpx('track', 'pageview');
    });
  }
})();
