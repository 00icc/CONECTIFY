const logger = require('../logger');

// This function can be imported and invoked during bridge initialization, 
// ensuring that if a bridge becomes unhealthy, it automatically attempts to reconnect.
function enableAutoReconnect(bridgeInitializer) {
  // Override the existing checkBridgeHealth method or wrap it to add reconnect logic
  const originalCheckBridgeHealth = bridgeInitializer.checkBridgeHealth.bind(bridgeInitializer);

  bridgeInitializer.checkBridgeHealth = async function (bridgeName) {
    try {
      // First, run the original health check
      const healthStatus = await originalCheckBridgeHealth(bridgeName);

      // If the original check sees the bridge as unhealthy or errored, try to reconnect
      if (healthStatus === 'error' || healthStatus === 'unhealthy') {
        logger.warn(`${bridgeName} appears to be disconnected (status: ${healthStatus}). Attempting auto-reconnect...`);
        const reconnectResult = await attemptReconnect(bridgeInitializer, bridgeName);
        return reconnectResult ? 'healthy' : 'error';
      }

      return healthStatus;

    } catch (error) {
      logger.error(`Error during auto-reconnect flow for ${bridgeName}:`, error);
      return 'error';
    }
  };

  // Helper function that retries the connection
  async function attemptReconnect(bridge, bridgeName) {
    const maxAttempts = bridge.maxRetries || 3;
    let success = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Clean up existing connection before attempting reconnect
        if (bridgeName === 'ae' && bridge.aeBridge) {
          await bridge.aeBridge.cleanup().catch(err => 
            logger.warn(`Cleanup for AE bridge failed: ${err.message}`));
        } else if (bridgeName === 'resolve' && bridge.resolveBridge) {
          await bridge.resolveBridge.cleanup().catch(err => 
            logger.warn(`Cleanup for Resolve bridge failed: ${err.message}`));
        }

        // Attempt reconnection
        if (bridgeName === 'ae') {
          logger.info(`Auto-reconnect attempt #${attempt} for After Effects...`);
          await bridge.initializeAE();
        } else if (bridgeName === 'resolve') {
          logger.info(`Auto-reconnect attempt #${attempt} for DaVinci Resolve...`);
          await bridge.initializeResolve();
        } else {
          throw new Error(`Unknown bridge type: ${bridgeName}`);
        }

        // If we reached here without error, the reconnect succeeded
        success = true;
        logger.info(`${bridgeName} reconnected successfully on attempt #${attempt}.`);
        break;

      } catch (error) {
        logger.warn(`${bridgeName} reconnect attempt #${attempt} failed: ${error.message}`);
        if (attempt < maxAttempts) {
          logger.info(`Will retry after ${bridge.retryDelay || 2000}ms...`);
          await pause(bridge.retryDelay || 2000);
        }
      }
    }

    if (!success) {
      logger.error(`Failed to reconnect to ${bridgeName} after ${maxAttempts} attempts.`);
    }

    return success;
  }

  // Utility function for pause/delay
  function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = enableAutoReconnect;