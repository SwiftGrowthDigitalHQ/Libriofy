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
    void navigator.serviceWorker
      .register(serviceWorkerUrl, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
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
