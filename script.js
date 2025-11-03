// MQTT Configuration - Replace with your HiveMQ cluster details
const MQTT_CONFIG = {
    host: '4809a06803844080a705e76187cf49ce.s1.eu.hivemq.cloud',  // Replace with your cluster URL
    port: 8884,  // WSS port for HiveMQ Cloud
    username: 'DC_Motor',  // Replace with your username
    password: 'EWS_Lab4',  // Replace with your password
    clientId: 'motor-dashboard-' + Math.random().toString(16).substr(2, 8)
};

// MQTT Topics
const TOPICS = {
    MOTOR_DATA: 'esp32/motor/data',
    MOTOR_CONTROL: 'esp32/motor/control',
    MOTOR_STATUS: 'esp32/motor/status'
};

// Global variables
let mqttClient = null;
let rpmChart = null;
let pwmChart = null;
let dataPoints = 0;
let lastUpdateTime = null;
// UI/Flow state
let calibrationInProgress = false;
let calibrationDone = false;
let selectedMode = null; // 'Speed' or 'Position'

// Chart configuration
const CHART_CONFIG = {
    maxDataPoints: 50,
    updateInterval: 1000
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeMQTT();
    initializeCharts();
    setupEventListeners();
    updateSystemInfo();
});

// MQTT Functions
function initializeMQTT() {
    console.log('Connecting to MQTT broker...');
    
    const options = {
        clientId: MQTT_CONFIG.clientId,
        username: MQTT_CONFIG.username,
        password: MQTT_CONFIG.password,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
    };

    const connectUrl = `wss://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}/mqtt`;
    
    try {
        mqttClient = mqtt.connect(connectUrl, options);
        
        mqttClient.on('connect', function() {
            console.log('Connected to MQTT broker');
            updateConnectionStatus(true);
            subscribeToTopics();
        });
        
        mqttClient.on('error', function(error) {
            console.error('MQTT connection error:', error);
            updateConnectionStatus(false);
        });
        
        mqttClient.on('close', function() {
            console.log('MQTT connection closed');
            updateConnectionStatus(false);
        });
        
        mqttClient.on('message', function(topic, message) {
            handleMQTTMessage(topic, message.toString());
        });
        
    } catch (error) {
        console.error('Failed to connect to MQTT:', error);
        updateConnectionStatus(false);
    }
}

function subscribeToTopics() {
    if (!mqttClient) return;
    
    mqttClient.subscribe([
        TOPICS.MOTOR_DATA,
        TOPICS.MOTOR_STATUS
    ], function(err) {
        if (!err) {
            console.log('Subscribed to MQTT topics');
        } else {
            console.error('Failed to subscribe to topics:', err);
        }
    });
}

function publishMQTTMessage(topic, message) {
    if (!mqttClient || !mqttClient.connected) {
        console.warn('MQTT client not connected');
        showNotification('MQTT not connected', 'error');
        return false;
    }
    
    mqttClient.publish(topic, message, { qos: 1 }, function(err) {
        if (err) {
            console.error('Failed to publish message:', err);
            showNotification('Failed to send command', 'error');
        } else {
            console.log(`Published to ${topic}: ${message}`);
        }
    });
    
    return true;
}

function handleMQTTMessage(topic, message) {
    console.log(`Received message from ${topic}: ${message}`);
    
    try {
        switch (topic) {
            case TOPICS.MOTOR_DATA:
                const motorData = JSON.parse(message);
                updateMotorData(motorData);
                break;
                
            case TOPICS.MOTOR_STATUS:
                const statusData = JSON.parse(message);
                updateMotorStatus(statusData);
                break;
                
            default:
                console.warn('Unknown topic:', topic);
        }
    } catch (error) {
        console.error('Error parsing MQTT message:', error);
    }
}

// Data Update Functions
function updateMotorData(data) {
    // Update metric displays
    updateElement('current-rpm', data.currentRPM, 1);
    updateElement('display-target-rpm', data.targetRPM, 1);
    updateElement('pwm-value', data.pwmValue);
    
    // Calculate and display error percentage
    const errorPercent = data.targetRPM !== 0 ? 
        Math.abs((data.targetRPM - data.currentRPM) / data.targetRPM * 100) : 0;
    updateElement('error-percent', errorPercent, 1);
    
    // Update motor direction
    updateMotorDirection(data.targetRPM);
    
    // Update charts
    updateCharts(data);
    
    // Update system info
    dataPoints++;
    lastUpdateTime = new Date();
    updateSystemInfo();
}

function updateMotorStatus(data) {
    const statusText = data.status || 'Unknown';
    const espEl = document.getElementById('esp32-status');
    if (espEl) espEl.textContent = statusText;

    // Handle calibration state from status messages
    if (typeof statusText === 'string') {
        const stateEl = document.getElementById('calibration-state');
        const infoBox = document.getElementById('calibration-info');
        const msgEl = document.getElementById('calibration-message');
        const gainsEl = document.getElementById('calibration-gains');

        if (/Autotuning process started/i.test(statusText)) {
            calibrationInProgress = true;
            calibrationDone = false;
            if (stateEl) stateEl.textContent = 'Autotuning…';
            if (infoBox) infoBox.style.display = 'block';
            if (msgEl) msgEl.textContent = 'Autotuning in progress…';
            if (gainsEl) gainsEl.textContent = '';
            disableModeControls();
        }

        if (/Autotuning complete/i.test(statusText)) {
            calibrationInProgress = false;
            calibrationDone = true;
            if (stateEl) stateEl.textContent = 'Completed';
            if (infoBox) infoBox.style.display = 'block';
            if (msgEl) msgEl.textContent = 'Autotuning complete. Gains learned:';
            // Extract gains if present
            const match = /Kp=([0-9.]+),\s*Ki=([0-9.]+),\s*Kd=([0-9.]+)/i.exec(statusText);
            if (match && gainsEl) {
                gainsEl.textContent = `Kp=${match[1]}  Ki=${match[2]}  Kd=${match[3]}`;
            }
            enableModeControls();
        }
    }
}

function updateElement(elementId, value, decimals = 0) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = typeof value === 'number' ? 
            value.toFixed(decimals) : value;
        element.classList.add('updating');
        setTimeout(() => element.classList.remove('updating'), 300);
    }
}

function updateMotorDirection(targetRPM) {
    const directionElement = document.getElementById('motor-direction');
    if (!directionElement) return;
    let direction, color;
    
    if (Math.abs(targetRPM) < 0.1) {
        direction = 'STOPPED';
        color = '#64748b';
    } else if (targetRPM > 0) {
        direction = 'FORWARD';
        color = '#10b981';
    } else {
        direction = 'REVERSE';
        color = '#f59e0b';
    }
    
    directionElement.textContent = direction;
    directionElement.style.color = color;
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('mqtt-status');
    const statusText = statusElement.querySelector('span');
    
    if (connected) {
        statusElement.className = 'status-indicator connected';
        statusText.textContent = 'Connected';
    } else {
        statusElement.className = 'status-indicator disconnected';
        statusText.textContent = 'Disconnected';
    }
}

function updateSystemInfo() {
    document.getElementById('data-points').textContent = dataPoints;
    document.getElementById('last-update').textContent = 
        lastUpdateTime ? lastUpdateTime.toLocaleTimeString() : 'Never';
}

// Chart Functions
function initializeCharts() {
    // RPM Chart
    const rpmCtx = document.getElementById('rpm-chart').getContext('2d');
    rpmChart = new Chart(rpmCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Target RPM',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4,
                    pointRadius: 2
                },
                {
                    label: 'Actual RPM',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: -400,
                    max: 400,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
    
    // PWM Chart
    const pwmCtx = document.getElementById('pwm-chart').getContext('2d');
    pwmChart = new Chart(pwmCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'PWM Value',
                data: [],
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                tension: 0.4,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 255,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
}

function updateCharts(data) {
    const currentTime = new Date().toLocaleTimeString();
    
    // Update RPM chart
    rpmChart.data.labels.push(currentTime);
    rpmChart.data.datasets[0].data.push(data.targetRPM);
    rpmChart.data.datasets[1].data.push(data.currentRPM);
    
    // Update PWM chart
    pwmChart.data.labels.push(currentTime);
    pwmChart.data.datasets[0].data.push(data.pwmValue);
    
    // Limit data points to prevent memory issues
    if (rpmChart.data.labels.length > CHART_CONFIG.maxDataPoints) {
        rpmChart.data.labels.shift();
        rpmChart.data.datasets[0].data.shift();
        rpmChart.data.datasets[1].data.shift();
        
        pwmChart.data.labels.shift();
        pwmChart.data.datasets[0].data.shift();
    }
    
    rpmChart.update('none');
    pwmChart.update('none');
}

// Event Listeners
function setupEventListeners() {
    // Calibration
    const startBtn = document.getElementById('start-calibration-btn');
    if (startBtn) {
        startBtn.addEventListener('click', startCalibration);
    }

    // Mode selection
    const rpmBtn = document.getElementById('mode-rpm-btn');
    const posBtn = document.getElementById('mode-position-btn');
    if (rpmBtn) rpmBtn.addEventListener('click', () => selectMode('Speed'));
    if (posBtn) posBtn.addEventListener('click', () => selectMode('Position'));

    // Send inputs
    const sendRpmBtn = document.getElementById('send-rpm-btn');
    const sendAngleBtn = document.getElementById('send-angle-btn');
    if (sendRpmBtn) sendRpmBtn.addEventListener('click', () => {
        const val = parseFloat(document.getElementById('target-rpm-input').value);
        sendRPMCommand(val);
    });
    if (sendAngleBtn) sendAngleBtn.addEventListener('click', () => {
        const val = parseFloat(document.getElementById('target-angle-input').value);
        sendAngleCommand(val);
    });

    // STOP button
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) stopBtn.addEventListener('click', () => sendRPMCommand(0));
}

function setQuickRPM(rpm) {
    // Legacy helper (not used in new UI)
    const input = document.getElementById('target-rpm-input');
    if (input) input.value = rpm;
    sendRPMCommand(rpm);
}

function sendRPMCommand(rpm) {
    if (!calibrationDone) {
        showNotification('Please complete calibration first', 'error');
        return;
    }
    if (isNaN(rpm)) {
        showNotification('Please enter a valid RPM value', 'error');
        return;
    }
    
    if (rpm < -350 || rpm > 350) {
        showNotification('RPM must be between -350 and 350', 'error');
        return;
    }
    
    const command = {
        targetRPM: rpm,
        timestamp: new Date().toISOString()
    };
    
    if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(command))) {
        showNotification(`RPM set to ${rpm}`, 'success');
    }
}

function sendAngleCommand(angle) {
    if (!calibrationDone) {
        showNotification('Please complete calibration first', 'error');
        return;
    }
    if (isNaN(angle)) {
        showNotification('Please enter a valid angle', 'error');
        return;
    }
    if (angle < -720 || angle > 720) {
        showNotification('Angle must be between -720° and 720°', 'error');
        return;
    }
    const command = {
        targetAngle: angle,
        timestamp: new Date().toISOString()
    };
    if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(command))) {
        showNotification(`Angle set to ${angle}°`, 'success');
    }
}

function startCalibration() {
    if (calibrationInProgress) return;
    const sent = publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify({ command: 'tune' }));
    if (sent) {
        calibrationInProgress = true;
        calibrationDone = false;
        const stateEl = document.getElementById('calibration-state');
        const infoBox = document.getElementById('calibration-info');
        const msgEl = document.getElementById('calibration-message');
        const gainsEl = document.getElementById('calibration-gains');
        if (stateEl) stateEl.textContent = 'Autotuning…';
        if (infoBox) infoBox.style.display = 'block';
        if (msgEl) msgEl.textContent = 'Autotuning in progress…';
        if (gainsEl) gainsEl.textContent = '';
        disableModeControls();
    }
}

function selectMode(mode) {
    if (!calibrationDone) {
        showNotification('Calibrate first to enable controls', 'error');
        return;
    }
    selectedMode = mode; // 'Speed' or 'Position'
    const rpmBtn = document.getElementById('mode-rpm-btn');
    const posBtn = document.getElementById('mode-position-btn');
    const rpmControls = document.getElementById('rpm-controls');
    const posControls = document.getElementById('position-controls');
    const sendRpmBtn = document.getElementById('send-rpm-btn');
    const sendAngleBtn = document.getElementById('send-angle-btn');
    const rpmInput = document.getElementById('target-rpm-input');
    const angInput = document.getElementById('target-angle-input');

    if (mode === 'Speed') {
        if (rpmBtn) { rpmBtn.classList.remove('secondary'); rpmBtn.classList.add('primary'); }
        if (posBtn) { posBtn.classList.remove('primary'); posBtn.classList.add('secondary'); }
        if (rpmControls) rpmControls.style.display = 'block';
        if (posControls) posControls.style.display = 'none';
        if (sendRpmBtn) sendRpmBtn.disabled = false;
        if (rpmInput) rpmInput.disabled = false;
        if (sendAngleBtn) sendAngleBtn.disabled = true;
        if (angInput) angInput.disabled = true;
    } else {
        if (posBtn) { posBtn.classList.remove('secondary'); posBtn.classList.add('primary'); }
        if (rpmBtn) { rpmBtn.classList.remove('primary'); rpmBtn.classList.add('secondary'); }
        if (posControls) posControls.style.display = 'block';
        if (rpmControls) rpmControls.style.display = 'none';
        if (sendAngleBtn) sendAngleBtn.disabled = false;
        if (angInput) angInput.disabled = false;
        if (sendRpmBtn) sendRpmBtn.disabled = true;
        if (rpmInput) rpmInput.disabled = true;
    }
}

function enableModeControls() {
    const rpmBtn = document.getElementById('mode-rpm-btn');
    const posBtn = document.getElementById('mode-position-btn');
    const stopBtn = document.getElementById('stop-btn');
    if (rpmBtn) rpmBtn.disabled = false;
    if (posBtn) posBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
}

function disableModeControls() {
    const rpmBtn = document.getElementById('mode-rpm-btn');
    const posBtn = document.getElementById('mode-position-btn');
    const stopBtn = document.getElementById('stop-btn');
    const sendRpmBtn = document.getElementById('send-rpm-btn');
    const sendAngleBtn = document.getElementById('send-angle-btn');
    const rpmInput = document.getElementById('target-rpm-input');
    const angInput = document.getElementById('target-angle-input');
    if (rpmBtn) rpmBtn.disabled = true;
    if (posBtn) posBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    if (sendRpmBtn) sendRpmBtn.disabled = true;
    if (sendAngleBtn) sendAngleBtn.disabled = true;
    if (rpmInput) rpmInput.disabled = true;
    if (angInput) angInput.disabled = true;
}

// Utility Functions
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        transition: all 0.3s ease;
        transform: translateX(100%);
    `;
    
    // Set background color based on type
    switch (type) {
        case 'success':
            notification.style.background = 'linear-gradient(45deg, #10b981, #059669)';
            break;
        case 'error':
            notification.style.background = 'linear-gradient(45deg, #f56565, #e53e3e)';
            break;
        default:
            notification.style.background = 'linear-gradient(45deg, #667eea, #764ba2)';
    }
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Simulate data for testing (remove when using real MQTT data)
function simulateData() {
    const data = {
        currentRPM: Math.random() * 700 - 350,
        targetRPM: 100,
        pwmValue: Math.floor(Math.random() * 255)
    };
    updateMotorData(data);
}

// Uncomment the line below for testing without ESP32
// setInterval(simulateData, 2000);

// Extend data updates to show mode and angles
function updateMotorData(data) {
    // Existing updates
    updateElement('current-rpm', data.currentRPM, 1);
    updateElement('display-target-rpm', data.targetRPM, 1);
    updateElement('pwm-value', data.pwmValue);

    // Error percent based on RPM mode
    const errorPercent = data.targetRPM !== 0 ?
        Math.abs((data.targetRPM - data.currentRPM) / (data.targetRPM || 1) * 100) : 0;
    updateElement('error-percent', errorPercent, 1);

    // New: show mode and angles
    if (data.mode) updateElement('display-mode', data.mode);
    if (typeof data.currentAngle === 'number') updateElement('current-angle', data.currentAngle, 1);
    if (typeof data.targetAngle === 'number') updateElement('target-angle', data.targetAngle, 1);

    // New: compute and show Angle Error (absolute degrees)
    if (typeof data.currentAngle === 'number' && typeof data.targetAngle === 'number') {
        const angleError = Math.abs(data.targetAngle - data.currentAngle);
        updateElement('angle-error', angleError, 1);
    }

    // Direction (optional)
    updateMotorDirection(data.targetRPM || 0);

    // Charts
    updateCharts(data);

    // System info
    dataPoints++;
    lastUpdateTime = new Date();
    updateSystemInfo();
}