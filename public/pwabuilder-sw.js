/**
 * PWABuilder Service Worker Compatibility Layer
 * This file exists for PWABuilder compatibility validation.
 * The primary service-worker.js handles all runtime caching.
 * PWABuilder uses this to verify offline capability during MSIX generation.
 */

// Redirect to the main service worker
importScripts('./service-worker.js');
