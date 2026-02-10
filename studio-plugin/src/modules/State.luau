local State = {}

State.CURRENT_VERSION = "1.9.0"

State.pluginState = {
	serverUrl = "http://localhost:58741",
	mcpServerUrl = "http://localhost:3001",
	isActive = false,
	pollInterval = 0.5,
	lastPoll = 0,
	consecutiveFailures = 0,
	maxFailuresBeforeError = 50,
	lastSuccessfulConnection = 0,
	currentRetryDelay = 0.5,
	maxRetryDelay = 5,
	retryBackoffMultiplier = 1.2,
	-- UI step tracking
	lastHttpOk = false,
	mcpWaitStartTime = nil,
	isPolling = false, -- Prevent concurrent poll requests
}

return State
