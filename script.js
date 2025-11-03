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
    document.getElementById('esp32-status').textContent = data.status || 'Unknown';
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
    // Set RPM button
    document.getElementById('set-rpm-btn').addEventListener('click', function() {
        const targetRPM = parseFloat(document.getElementById('target-rpm').value);
        sendRPMCommand(targetRPM);
    });
    
    // Enter key on RPM input
    document.getElementById('target-rpm').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const targetRPM = parseFloat(this.value);
            sendRPMCommand(targetRPM);
        }
    });
    
    // Quick control buttons are handled by onclick in HTML
}

function setQuickRPM(rpm) {
    document.getElementById('target-rpm').value = rpm;
    sendRPMCommand(rpm);
}

function sendRPMCommand(rpm) {
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