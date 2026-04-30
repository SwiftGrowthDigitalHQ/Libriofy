const shouldRegisterServiceWorker = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  import.meta.env.PROD;

export const registerServiceWorker = () => {
  if (!shouldRegisterServiceWorker()) {
    return;
  }

  const serviceWorkerUrl = `${import.meta.env.BASE_URL}service-worker.js`;

  window.addEventListener("load", () => {
    let hasRefreshedForNewWorker = false;

    const activateWaitingWorker = (registration: ServiceWorkerRegistration) => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hasRefreshedForNewWorker) {
        return;
      }

      hasRefreshedForNewWorker = true;
      window.location.reload();
    });

    void navigator.serviceWorker
      .register(serviceWorkerUrl, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        activateWaitingWorker(registration);
        void registration.update();

        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) {
            return;
          }

          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              activateWaitingWorker(registration);
            }
          });
        });

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            void registration.update();
          }
        });
      })
      .catch((error) => {
        console.error("Libriofy service worker registration failed", error);
      });
  });
};
