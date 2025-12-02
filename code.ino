#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>

// ------------ WiFi Configuration ------------
const char* ssid = "Samsung Galaxy S24+";
const char* password = "159357000";

// ------------ MQTT Configuration ------------
const char* mqtt_server = "4809a06803844080a705e76187cf49ce.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_username = "DC_Motor";
const char* mqtt_password = "EWS_Lab4";
const char* mqtt_client_id = "esp32-motor-controller-autotune";

const char* TOPIC_MOTOR_DATA = "esp32/motor/data";
const char* TOPIC_MOTOR_CONTROL = "esp32/motor/control";
const char* TOPIC_MOTOR_STATUS = "esp32/motor/status";

WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// ------------ Pins for setup ------------
#define ENCODER_A 13
#define ENCODER_B 14
#define PWM_PIN   19
#define IN1_PIN   26
#define IN2_PIN   25

// ------------ Encoder Configuration ------------
const int PPR = 600;
const int COUNTS_PER_REV = PPR * 4;

volatile long encoderCount = 0;
volatile long totalEncoderCount = 0;
volatile uint8_t lastAB = 0;

const int8_t qdelta[16] = {
  0,  1, -1,  0, -1,  0,  0,  1,
  1,  0,  0, -1,  0, -1,  1,  0
};

void IRAM_ATTR encoderISR() {
  uint8_t a = digitalRead(ENCODER_A);
  uint8_t b = digitalRead(ENCODER_B);
  uint8_t ab = (a << 1) | b;
  uint8_t idx = (lastAB << 2) | ab;
  int8_t delta = qdelta[idx];
  encoderCount += delta;
  totalEncoderCount += delta; // For position tracking
  lastAB = ab;
}

// ------------ Motor Calibration ------------
const int tableSize = 29;
float calibPWM[tableSize] = {25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 220, 240, 255};
float calibRPM[tableSize] = {7.6, 27.5, 51.5, 77.8, 105.0, 130.0, 151.0, 171.0, 186.5, 200.0, 210.0, 220.0, 230.0, 236.0, 245.0, 250.0, 261.0, 270.0, 277.0, 282.0, 288.0, 292.0, 295.5, 298.0, 302.0, 305.0, 309.0, 313.0, 317.0};

int pwmFromRPM(float rpm) {
  rpm = fabs(rpm);
  if (rpm <= calibRPM[0]) return calibPWM[0];
  if (rpm >= calibRPM[tableSize - 1]) return calibPWM[tableSize - 1];
  for (int i = 0; i < tableSize - 1; ++i) {
    if (rpm >= calibRPM[i] && rpm <= calibRPM[i + 1]) {
      float t = (rpm - calibRPM[i]) / (calibRPM[i + 1] - calibRPM[i]);
      return (int)(calibPWM[i] + t * (calibPWM[i + 1] - calibPWM[i]));
    }
  }
  return calibPWM[0];
}

// ------------ PID Control Modes ------------
enum PIDMode {
  MODE_P_ONLY,      // Proportional only (Ki=0, Kd=0)
  MODE_PI_ONLY,     // Proportional + Integral (Kd=0)
  MODE_PID_FULL     // Full PID
};

PIDMode currentPIDMode = MODE_PID_FULL;

// ------------ PID & Control Params ------------
unsigned long lastControlMs = 0;
unsigned long lastMqttPublishMs = 0;
const unsigned long controlIntervalMs = 100;
const unsigned long mqttPublishIntervalMs = 100;

float rpmFiltered = 0.0f;
const float alpha = 0.4f;

volatile float targetRPM = 0.0f;

// PID Gains (for speed) - Base values
double Kp_base = 0.0;
double Ki_base = 0.0;
double Kd_base = 0.00;

// Active PID gains (will be modified based on mode)
double Kp = 0.0;
double Ki = 0.0;
double Kd = 0.00;
double integral = 0.0, prevError = 0.0;
const double integralLimit = 255;

// PID Gains (for position)
double posKp = 0.0;
double posKi = 0.0;
double posKd = 0.0;
double posIntegral = 0.0, posPrevError = 0.0;
const double posIntegralLimit = 255;

// Position tracking
float targetAngle = 0.0;
float currentAngle = 0.0;

// ------------ Control State Machine ------------
enum ControlState {
  STATE_PID_RUNNING,
  STATE_AUTOTUNE_START,
  STATE_AUTOTUNE_RELAY_STEP,
  STATE_POSITION_CONTROL
};
ControlState currentState = STATE_PID_RUNNING;

// ------------ Autotune Params ------------
const float TUNE_SETPOINT_RPM = 150.0;
const int TUNE_RELAY_AMP = 50;
const int TUNE_CYCLES = 15;
unsigned long lastCrossingTime = 0;
float lastRpm = 0, peakRpm = 0, troughRpm = 0;
int crossings = 0;
double sum_Tu = 0, sum_a = 0;

// Autotune target selection
enum AutotuneTarget {
  TUNE_SPEED,
  TUNE_POSITION
};
AutotuneTarget autotuneTarget = TUNE_SPEED;

int currentPWM = 0;
bool motorRunning = false;

// ------------ Function Prototypes ------------
void setupWiFi();
void setupMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void handleControlCommand(String message);
void connectMQTT();
void publishMotorData();
void publishStatus(const char* status);
void runAutotuner();
void runPIDControl();
void runPositionControl();
void stopMotor();
void setPIDMode(PIDMode mode);
void updatePIDGains();

// ------------ Setup ------------
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println("ESP32 Motor Control (RPM + Position + Autotune + PID Modes) starting...");

  setupWiFi();
  setupMQTT();

  pinMode(ENCODER_A, INPUT_PULLUP);
  pinMode(ENCODER_B, INPUT_PULLUP);
  lastAB = (digitalRead(ENCODER_A) << 1) | digitalRead(ENCODER_B);
  attachInterrupt(digitalPinToInterrupt(ENCODER_A), encoderISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_B), encoderISR, CHANGE);

  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  pinMode(PWM_PIN, OUTPUT);

  lastControlMs = millis();
  lastMqttPublishMs = millis();

  Serial.println("System ready. Use MQTT or Serial: 'tune', 'targetRPM', 'angle <deg>', or 'mode <P|PI|PID>'");
}

// ------------ Main Loop ------------
void loop() {
  if (!mqttClient.connected()) connectMQTT();
  mqttClient.loop();

  if (WiFi.status() != WL_CONNECTED) setupWiFi();

  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd == "tune" || cmd == "tuneSpeed") {
      autotuneTarget = TUNE_SPEED;
      currentState = STATE_AUTOTUNE_START;
      publishStatus("Speed Autotuning initiated via Serial");
    } else if (cmd == "tunePosition") {
      autotuneTarget = TUNE_POSITION;
      currentState = STATE_AUTOTUNE_START;
      publishStatus("Position Autotuning initiated via Serial");
    } else if (cmd.startsWith("angle")) {
      targetAngle = cmd.substring(6).toFloat();
      totalEncoderCount = 0;
      posIntegral = posPrevError = 0;
      currentState = STATE_POSITION_CONTROL;
      Serial.print("Target angle set via Serial: ");
      Serial.println(targetAngle);
    } else if (cmd.startsWith("mode")) {
      String mode = cmd.substring(5);
      mode.trim();
      mode.toUpperCase();
      if (mode == "P") {
        setPIDMode(MODE_P_ONLY);
        Serial.println("Mode set to P-only (Ki=0, Kd=0)");
      } else if (mode == "PI") {
        setPIDMode(MODE_PI_ONLY);
        Serial.println("Mode set to PI-only (Kd=0)");
      } else if (mode == "PID") {
        setPIDMode(MODE_PID_FULL);
        Serial.println("Mode set to full PID");
      }
    } else {
      targetRPM = cmd.toFloat();
      integral = prevError = 0;
      currentState = STATE_PID_RUNNING;
      Serial.print("Target RPM set via Serial: ");
      Serial.println(targetRPM);
    }
  }

  unsigned long now = millis();

  if (now - lastControlMs >= controlIntervalMs) {
    long elapsed = now - lastControlMs;
    lastControlMs = now;

    noInterrupts();
    long cnt = encoderCount;
    encoderCount = 0;
    interrupts();

    float revolutions = (float)cnt / (float)COUNTS_PER_REV;
    float rpm = (elapsed > 0) ? (revolutions * 60000.0f / (float)elapsed) : 0.0f;
    rpmFiltered = (rpmFiltered == 0.0f) ? rpm : (alpha * rpm + (1.0f - alpha) * rpmFiltered);

    switch (currentState) {
      case STATE_PID_RUNNING:
        runPIDControl();
        break;
      case STATE_AUTOTUNE_START:
        Serial.println("\n--- STARTING AUTOTUNE ---");
        publishStatus("Autotuning process started.");
        lastCrossingTime = 0; lastRpm = TUNE_SETPOINT_RPM;
        peakRpm = TUNE_SETPOINT_RPM; troughRpm = TUNE_SETPOINT_RPM;
        crossings = 0; sum_Tu = 0; sum_a = 0;
        currentState = STATE_AUTOTUNE_RELAY_STEP;
        break;
      case STATE_AUTOTUNE_RELAY_STEP:
        runAutotuner();
        break;
      case STATE_POSITION_CONTROL:
        runPositionControl();
        break;
    }

    Serial.print("Mode: ");
    Serial.print((currentState == STATE_POSITION_CONTROL) ? "POS" : (currentState == STATE_PID_RUNNING ? "PID" : "TUNE"));
    Serial.print(", Target: ");
    Serial.print((currentState == STATE_POSITION_CONTROL) ? targetAngle : targetRPM);
    Serial.print(", PWM: ");
    Serial.println(currentPWM);
  }

  if (now - lastMqttPublishMs >= mqttPublishIntervalMs) {
    lastMqttPublishMs = now;
    publishMotorData();
  }
}

// ------------ PID Mode Control ------------
void setPIDMode(PIDMode mode) {
  currentPIDMode = mode;
  integral = 0;  // Reset integral when changing modes
  prevError = 0;
  updatePIDGains();
  
  char msg[100];
  sprintf(msg, "PID Mode changed to: %s", 
          mode == MODE_P_ONLY ? "P-only" : 
          mode == MODE_PI_ONLY ? "PI-only" : "Full PID");
  publishStatus(msg);
}

void updatePIDGains() {
  switch (currentPIDMode) {
    case MODE_P_ONLY:
      Kp = Kp_base;
      Ki = 0.0;
      Kd = 0.0;
      break;
    case MODE_PI_ONLY:
      Kp = Kp_base;
      Ki = Ki_base;
      Kd = 0.0;
      break;
    case MODE_PID_FULL:
      Kp = Kp_base;
      Ki = Ki_base;
      Kd = Kd_base;
      break;
  }
}

// ------------ PID (Speed) Control ------------
void runPIDControl() {
  if (abs(targetRPM) < 0.1) { stopMotor(); return; }

  double error = targetRPM - rpmFiltered;
  double dt = (double)controlIntervalMs / 1000.0;
  integral += error * dt;
  integral = constrain(integral, -integralLimit, integralLimit);
  double derivative = (dt > 0) ? (error - prevError) / dt : 0.0;
  double correction = Kp * error + Ki * integral + Kd * derivative;
  prevError = error;

  int pwmFF = pwmFromRPM(targetRPM);
  int pwmVal = (targetRPM < 0) ? (pwmFF - (int)correction) : (pwmFF + (int)correction);
  pwmVal = constrain(pwmVal, 0, 255);
  currentPWM = pwmVal;

  if (targetRPM > 0) { digitalWrite(IN1_PIN, HIGH); digitalWrite(IN2_PIN, LOW); }
  else { digitalWrite(IN1_PIN, LOW); digitalWrite(IN2_PIN, HIGH); }
  analogWrite(PWM_PIN, pwmVal);
  motorRunning = true;
}

// ------------ Position Control ------------
void runPositionControl() {
  currentAngle = ((float)totalEncoderCount / (float)COUNTS_PER_REV) * 360.0;
  double error = targetAngle - currentAngle;
  double dt = (double)controlIntervalMs / 1000.0;

  posIntegral += error * dt;
  posIntegral = constrain(posIntegral, -posIntegralLimit, posIntegralLimit);
  double derivative = (dt > 0) ? (error - posPrevError) / dt : 0.0;
  double output = posKp * error + posKi * posIntegral + posKd * derivative;
  posPrevError = error;

  int pwmVal = abs(output);
  pwmVal = constrain(pwmVal, 0, 255);

  if (error > 0) { digitalWrite(IN1_PIN, HIGH); digitalWrite(IN2_PIN, LOW); }
  else if (error < 0) { digitalWrite(IN1_PIN, LOW); digitalWrite(IN2_PIN, HIGH); }
  else { stopMotor(); return; }

  analogWrite(PWM_PIN, pwmVal);
  currentPWM = pwmVal;

  if (abs(error) < 2.0) {
    stopMotor();
    publishStatus("Position reached target");
    Serial.println("Position reached target angle!");
  }

  Serial.print("TargetAngle: "); Serial.print(targetAngle);
  Serial.print(" | CurrentAngle: "); Serial.print(currentAngle);
  Serial.print(" | Error: "); Serial.print(error);
  Serial.print(" | PWM: "); Serial.println(pwmVal);
}

// ------------ Autotuner (Relay Method) ------------
void runAutotuner() {
  int pwmFF = pwmFromRPM(TUNE_SETPOINT_RPM);
  int pwmVal = (rpmFiltered < TUNE_SETPOINT_RPM) ? (pwmFF + TUNE_RELAY_AMP) : (pwmFF - TUNE_RELAY_AMP);
  pwmVal = constrain(pwmVal, 0, 255);
  currentPWM = pwmVal;
  digitalWrite(IN1_PIN, HIGH); digitalWrite(IN2_PIN, LOW);
  analogWrite(PWM_PIN, pwmVal); motorRunning = true;

  if (lastRpm < TUNE_SETPOINT_RPM && rpmFiltered >= TUNE_SETPOINT_RPM) {
    unsigned long now = millis();
    if (lastCrossingTime > 0) {
      long period_Tu = now - lastCrossingTime;
      crossings++;
      if (crossings > 2) {
        sum_Tu += period_Tu;
        sum_a += (peakRpm - troughRpm) / 2.0;
      }
    }
    lastCrossingTime = now;
    troughRpm = peakRpm;
  }

  if (rpmFiltered > peakRpm) peakRpm = rpmFiltered;
  if (rpmFiltered < troughRpm) troughRpm = rpmFiltered;
  lastRpm = rpmFiltered;

  if (crossings >= (TUNE_CYCLES + 2)) {
    double avg_Tu_ms = sum_Tu / TUNE_CYCLES;
    double avg_a = sum_a / TUNE_CYCLES;
    double Ku = (4.0 * TUNE_RELAY_AMP) / (PI * avg_a);
    double Tu_sec = avg_Tu_ms / 1000.0;

    if (autotuneTarget == TUNE_SPEED) {
      // Ziegler-Nichols for Speed Control
      Kp_base = 0.6 * Ku;
      Ki_base = Kp_base / (Tu_sec / 2.0);
      Kd_base = Kp_base * (Tu_sec / 8.0);
      updatePIDGains();  // Apply gains based on current mode

      char msg[150];
      sprintf(msg, "Speed Autotune complete. Kp=%.4f, Ki=%.4f, Kd=%.4f", Kp_base, Ki_base, Kd_base);
      Serial.println(msg);
      publishStatus(msg);
    } else {
      // Modified Ziegler-Nichols for Position/Servo Control
      // Higher Kp for stiffness, much lower Ki to prevent windup, higher Kd for damping
      posKp = 0.8 * Ku;              // More aggressive proportional (vs 0.6 for speed)
      posKi = posKp / (4.0 * Tu_sec); // Much lower integral (4x vs 2x for speed)
      posKd = posKp * (Tu_sec / 4.0); // Higher derivative (4x vs 8x for speed)

      char msg[150];
      sprintf(msg, "Position Autotune complete. posKp=%.4f, posKi=%.4f, posKd=%.4f", posKp, posKi, posKd);
      Serial.println(msg);
      publishStatus(msg);
    }
    
    targetRPM = 0.0; integral = prevError = 0;
    currentState = STATE_PID_RUNNING;
    stopMotor();
  }
}

// ------------ Utility Functions ------------
void stopMotor() {
  digitalWrite(IN1_PIN, LOW); digitalWrite(IN2_PIN, LOW);
  analogWrite(PWM_PIN, 0);
  currentPWM = 0;
  motorRunning = false;
}

void setupWiFi() {
  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi connected!");
  Serial.print("IP: "); Serial.println(WiFi.localIP());
}

void setupMQTT() {
  wifiClient.setInsecure();
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
}

void connectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT...");
    if (mqttClient.connect(mqtt_client_id, mqtt_username, mqtt_password)) {
      Serial.println("connected!");
      mqttClient.subscribe(TOPIC_MOTOR_CONTROL);
      publishStatus("ESP32 online");
    } else {
      Serial.println("retry in 5s...");
      delay(5000);
    }
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  if (String(topic) == TOPIC_MOTOR_CONTROL) handleControlCommand(message);
}

void handleControlCommand(String message) {
  DynamicJsonDocument doc(256);
  if (deserializeJson(doc, message)) return;
  
  if (doc.containsKey("command")) {
    String cmd = doc["command"].as<String>();
    if (cmd == "tune" || cmd == "tuneSpeed") {
      autotuneTarget = TUNE_SPEED;
      currentState = STATE_AUTOTUNE_START;
      publishStatus("Speed Autotuning via MQTT");
    } else if (cmd == "tunePosition") {
      autotuneTarget = TUNE_POSITION;
      currentState = STATE_AUTOTUNE_START;
      publishStatus("Position Autotuning via MQTT");
    }
  } else if (doc.containsKey("pidMode")) {
    String mode = doc["pidMode"].as<String>();
    mode.toUpperCase();
    if (mode == "P") {
      setPIDMode(MODE_P_ONLY);
    } else if (mode == "PI") {
      setPIDMode(MODE_PI_ONLY);
    } else if (mode == "PID") {
      setPIDMode(MODE_PID_FULL);
    }
  } else if (doc.containsKey("targetRPM")) {
    targetRPM = doc["targetRPM"];
    integral = prevError = 0;
    currentState = STATE_PID_RUNNING;
    publishStatus("RPM control via MQTT");
  } else if (doc.containsKey("targetAngle")) {
    targetAngle = doc["targetAngle"];
    totalEncoderCount = 0;
    posIntegral = posPrevError = 0;
    currentState = STATE_POSITION_CONTROL;
    publishStatus("Position control via MQTT");
  }
}

void publishMotorData() {
  if (!mqttClient.connected()) return;
  DynamicJsonDocument doc(512);
  doc["currentRPM"] = rpmFiltered;
  doc["targetRPM"] = targetRPM;
  doc["currentAngle"] = currentAngle;
  doc["targetAngle"] = targetAngle;
  doc["pwmValue"] = currentPWM;
  doc["mode"] = (currentState == STATE_POSITION_CONTROL) ? "Position" : "Speed";
  doc["pidMode"] = (currentPIDMode == MODE_P_ONLY) ? "P" : 
                   (currentPIDMode == MODE_PI_ONLY) ? "PI" : "PID";
  doc["Kp"] = Kp; 
  doc["Ki"] = Ki; 
  doc["Kd"] = Kd;
  doc["posKp"] = posKp;
  doc["posKi"] = posKi;
  doc["posKd"] = posKd;
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish(TOPIC_MOTOR_DATA, payload.c_str());
}

void publishStatus(const char* status) {
  if (!mqttClient.connected()) return;
  DynamicJsonDocument doc(256);
  doc["status"] = status;
  doc["timestamp"] = millis();
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish(TOPIC_MOTOR_STATUS, payload.c_str());
}