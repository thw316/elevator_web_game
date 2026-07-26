/**
 * app.js — Elevator Game Logic & Animation Controller
 *
 * State machine: IDLE → CLOSING → MOVING → ARRIVING → OPENING → IDLE
 * Floor numbering: B99(-99) ... B1(-1), 1 ... 999 (no floor 0)
 *
 * Movement Physics — Trapezoidal Velocity Profile:
 *   Acceleration phase: d(t) = ½ · a · t²
 *   Cruise phase:       d(t) = d_acc + v_max · (t − t_acc)
 *   Deceleration phase: d(t) = D − ½ · a · (T − t)²
 */

/* ===== Constants ===== */
const State = Object.freeze({
  IDLE:     'idle',
  CLOSING:  'closing',
  MOVING:   'moving',
  ARRIVING: 'arriving',
  OPENING:  'opening',
});

const VISIBLE_FLOORS = 11;
const BUFFER_SLOTS   = 1;       // 1 hidden slot top & bottom
const TOTAL_SLOTS    = VISIBLE_FLOORS + 2 * BUFFER_SLOTS; // 13
const SLOT_HEIGHT    = 46;      // px per floor slot
const CENTER_SLOT    = Math.floor(TOTAL_SLOTS / 2);       // index 6

const MIN_FLOOR = -99;
const MAX_FLOOR = 999;

/* ===== Elevator Physics Constants ===== */
const FLOOR_HEIGHT = 3.3;       // meters per floor
const MAX_ACCEL    = 1.26;      // m/s² (Taipei 101 spec)
const MAX_SPEED_UP   = 16.83;   // m/s (Taipei 101 upward cruise speed, 1010 m/min)
const MAX_SPEED_DOWN = 10.0;    // m/s (Taipei 101 downward cruise speed, 600 m/min)
const MAX_TRAVEL_TIME = 40;     // seconds — trips longer than this are compressed

/* ===== Elevator Game Class ===== */
class ElevatorGame {
  constructor() {
    this.state        = State.IDLE;
    this.currentFloor = 1;
    this.targetFloor  = 1;
    this.audio        = new ElevatorAudio();
    this.shaftTimeout = null;
    this._submitLocked = false;
    this.announceFloor = false;

    // Energy state
    this.recoveryMinutes = 10;
    this.maxEnergy = 20;
    this.currentEnergy = 20;
    this.lastRecoveryTime = Date.now();
    this.energyTimerInterval = null;

    // DOM references
    this.floorDisplay = document.getElementById('floor-display');
    this.arrowUp      = document.getElementById('arrow-up');
    this.arrowDown    = document.getElementById('arrow-down');
    this.doorLeft     = document.getElementById('door-left');
    this.doorRight    = document.getElementById('door-right');
    this.floorInput   = document.getElementById('floor-input');
    this.floorForm    = document.getElementById('floor-form');

    this.shaftStrip   = document.getElementById('shaft-strip');
    this.voiceStatus  = document.getElementById('voice-status');

    this.energyPanel    = document.getElementById('energy-panel');
    this.energyText     = document.getElementById('energy-text');
    this.energyTimer    = document.getElementById('energy-timer');
    this.energyTimerContainer = document.getElementById('energy-timer-container');

    this._init();
  }

  /* ---------- Initialization ---------- */
  _init() {
    // Build shaft floor slots
    this._generateShaftSlots();
    this._updateShaft(this.currentFloor);
    this._updateFloorDisplay(this.currentFloor);

    // Idle glow
    this.floorDisplay.classList.add('idle-glow');

    // Event listeners — form submit handles both Enter key and GO button click
    if (this.floorForm) {
      this.floorForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this._submitLocked) return; // prevent repeated Enter key-repeat
        this._submitLocked = true;
        this._handleGo();
      });
    }

    // Release the submit lock when any key is released (handles held Enter)
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        this._submitLocked = false;
      }
    });

    // Also listen for input sanitization
    this.floorInput.addEventListener('input', () => this._handleInput());

    // Initialize audio on first user gesture
    const initAudio = () => { this.audio.init(); };
    document.addEventListener('click',   initAudio, { once: true });
    document.addEventListener('keydown', initAudio, { once: true });

    // Load setting.ini
    fetch('setting.ini')
      .then(response => response.text())
      .then(text => {
        const matchAudio = text.match(/announce_floor\s*=\s*(true|false)/i);
        if (matchAudio) {
          this.announceFloor = matchAudio[1].toLowerCase() === 'true';
          console.log('[ElevatorGame] Setting loaded. announceFloor:', this.announceFloor);
        }

        const matchRecovery = text.match(/recovery_minutes\s*=\s*(\d+)/i);
        if (matchRecovery) {
          this.recoveryMinutes = parseInt(matchRecovery[1], 10);
        }

        const matchMaxEnergy = text.match(/max_energy\s*=\s*(\d+)/i);
        if (matchMaxEnergy) {
          this.maxEnergy = parseInt(matchMaxEnergy[1], 10);
        }
      })
      .catch(err => {
        console.warn('Could not load setting.ini:', err);
      })
      .finally(() => {
        if (this.voiceStatus) {
          this.voiceStatus.textContent = this.announceFloor ? '開啟' : '關閉';
        }
        this._initEnergySystem();
      });

    // Auto-focus input
    this.floorInput.focus();

    console.log('[ElevatorGame] Initialized successfully. State:', this.state);
  }

  /* ---------- Energy System ---------- */
  _initEnergySystem() {
    // Attempt to load from localStorage
    const savedEnergy = localStorage.getItem('elevator_energy');
    const savedTime = localStorage.getItem('elevator_energy_time');

    if (savedEnergy !== null && savedTime !== null) {
      let energy = parseInt(savedEnergy, 10);
      let lastTime = parseInt(savedTime, 10);
      let now = Date.now();
      
      if (energy < this.maxEnergy) {
        let recoveryMs = this.recoveryMinutes * 60 * 1000;
        let elapsed = now - lastTime;
        let recoveredPoints = Math.floor(elapsed / recoveryMs);
        
        if (recoveredPoints > 0) {
          energy = Math.min(this.maxEnergy, energy + recoveredPoints);
          lastTime += recoveredPoints * recoveryMs; // Advance the timer by exact full periods
        }
      } else {
        lastTime = now; // If full, keep timer current
      }
      
      this.currentEnergy = energy;
      this.lastRecoveryTime = lastTime;
    } else {
      this.currentEnergy = this.maxEnergy;
      this.lastRecoveryTime = Date.now();
    }
    
    this._saveEnergyState();
    this._updateEnergyUI();
    
    if (this.energyTimerInterval) clearInterval(this.energyTimerInterval);
    this.energyTimerInterval = setInterval(() => this._checkEnergyRecovery(), 1000);
  }

  _checkEnergyRecovery() {
    if (this.currentEnergy >= this.maxEnergy) {
      this.currentEnergy = this.maxEnergy;
      this.lastRecoveryTime = Date.now();
      this._updateEnergyUI();
      return;
    }

    let now = Date.now();
    let recoveryMs = this.recoveryMinutes * 60 * 1000;
    
    if (now - this.lastRecoveryTime >= recoveryMs) {
      this.currentEnergy++;
      this.lastRecoveryTime += recoveryMs;
      this._saveEnergyState();
    }
    this._updateEnergyUI();
  }
  
  _saveEnergyState() {
    localStorage.setItem('elevator_energy', this.currentEnergy.toString());
    localStorage.setItem('elevator_energy_time', this.lastRecoveryTime.toString());
  }

  _updateEnergyUI() {
    if (!this.energyText || !this.energyTimer || !this.energyTimerContainer) return;
    
    this.energyText.textContent = `${this.currentEnergy} / ${this.maxEnergy}`;
    
    if (this.currentEnergy >= this.maxEnergy) {
      this.energyTimerContainer.style.display = 'none';
    } else {
      this.energyTimerContainer.style.display = 'block';
      let now = Date.now();
      let recoveryMs = this.recoveryMinutes * 60 * 1000;
      let nextRecoveryIn = recoveryMs - (now - this.lastRecoveryTime);
      if (nextRecoveryIn < 0) nextRecoveryIn = 0;
      
      let totalSeconds = Math.floor(nextRecoveryIn / 1000);
      let mins = Math.floor(totalSeconds / 60);
      let secs = totalSeconds % 60;
      
      this.energyTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }

  /* ---------- Shaft Setup ---------- */
  _generateShaftSlots() {
    this.shaftStrip.innerHTML = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'shaft-floor';
      slot.addEventListener('click', () => {
        if (this.state !== State.IDLE) return;
        const label = slot.textContent.trim();
        if (label) {
          this.floorInput.value = label;
          this._handleGo();
        }
      });
      this.shaftStrip.appendChild(slot);
    }
    this.shaftStrip.style.transform = `translateY(-${SLOT_HEIGHT}px)`;
  }

  /** Update all shaft slot labels centered on the given floor */
  _updateShaft(centerFloor) {
    const slots = this.shaftStrip.children;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const offset = CENTER_SLOT - i; // positive = above center
      const floor = this._getFloorAtOffset(centerFloor, offset);
      slots[i].textContent = this._formatFloorLabel(floor);
    }
  }

  /* ---------- Floor Helpers ---------- */

  /**
   * Get the floor number that is `offset` floors away from `center`.
   * Positive offset = above, negative = below. Skips floor 0.
   */
  _getFloorAtOffset(center, offset) {
    if (offset === 0) return center;
    const step = offset > 0 ? 1 : -1;
    let floor = center;
    const count = Math.abs(offset);
    for (let i = 0; i < count; i++) {
      floor += step;
      if (floor === 0) floor += step; // skip floor 0
    }
    return floor;
  }

  /** Format floor number for the shaft labels */
  _formatFloorLabel(n) {
    if (n === 0 || n < MIN_FLOOR || n > MAX_FLOOR) return '';
    if (n < 0) return 'B' + Math.abs(n);
    return '' + n;
  }

  /** Format floor number for the LED display */
  _formatFloorDisplay(n) {
    if (n < 0) return 'B' + Math.abs(n);
    return '' + n;
  }

  /**
   * Parse user input string to an internal floor number.
   * Returns null if invalid.
   */
  _parseFloorInput(value) {
    var v = value.trim().toUpperCase();
    if (!v) return null;

    if (v.charAt(0) === 'B') {
      var numStr = v.substring(1);
      if (!numStr || !/^\d+$/.test(numStr)) return null;
      var num = parseInt(numStr, 10);
      if (num < 1 || num > 99) return null;
      return -num;
    } else {
      if (!/^\d+$/.test(v)) return null;
      var num = parseInt(v, 10);
      if (num < 1 || num > 999) return null;
      return num;
    }
  }

  /* ---------- Input Handling ---------- */

  /** Sanitize input value after any change */
  _handleInput() {
    var cursorPos = this.floorInput.selectionStart;
    var oldValue = this.floorInput.value;

    // Uppercase & remove invalid chars
    var v = oldValue.toUpperCase().replace(/[^0-9B]/g, '');

    // Ensure B only at position 0, max one B
    if (v.indexOf('B') !== -1) {
      if (v.charAt(0) === 'B') {
        // Keep first B, strip any others
        v = 'B' + v.substring(1).replace(/B/g, '');
      } else {
        // B not at start → remove all B
        v = v.replace(/B/g, '');
      }
    }

    if (v !== oldValue) {
      this.floorInput.value = v;
      var newPos = Math.min(cursorPos, v.length);
      this.floorInput.setSelectionRange(newPos, newPos);
    }
  }

  /* ---------- Submit & Validation ---------- */

  _handleGo() {
    if (this.state !== State.IDLE) return;

    // Ensure audio is ready
    this.audio.init();

    var target = this._parseFloorInput(this.floorInput.value);

    if (target === null || target === this.currentFloor) {
      this._showError();
      return;
    }

    if (this.currentEnergy < 1) {
      this._showLowEnergyError();
      return;
    }

    // Deduct energy
    this.currentEnergy--;
    if (this.currentEnergy === this.maxEnergy - 1) {
      // Just started recovering, reset timer to now
      this.lastRecoveryTime = Date.now();
    }
    this._saveEnergyState();
    this._updateEnergyUI();

    this.targetFloor = target;
    // Keep the input value visible during travel — it will be cleared after arrival
    this._startElevator();
  }

  _showError() {
    this.floorInput.classList.add('shake');
    this.audio.playErrorBeep();
    var self = this;
    setTimeout(function() {
      self.floorInput.classList.remove('shake');
    }, 600);
  }

  _showLowEnergyError() {
    this._showError();
    if (this.energyPanel) {
      this.energyPanel.classList.add('error-flash');
      setTimeout(() => {
        this.energyPanel.classList.remove('error-flash');
      }, 600);
    }
  }

  /* ---------- Elevator Sequence ---------- */

  async _startElevator() {
    this._setInputEnabled(false);
    this.floorDisplay.classList.remove('idle-glow');

    // 1. Close doors
    await this._closeDoors();

    // 2. Move to target floor
    await this._moveToFloor();

    // 3. Speak the arrived floor in English
    if (this.announceFloor) {
      this.audio.speakFloor(this.currentFloor);
    }

    // 4. Open doors
    await this._openDoors();

    // 5. Clear input after arrival, re-enable and focus
    this.floorInput.value = '';
    this.floorDisplay.classList.add('idle-glow');
    this._setInputEnabled(true);
    this.floorInput.focus();
  }

  _setInputEnabled(enabled) {
    this.floorInput.disabled = !enabled;
  }

  /* ----- Door Animations ----- */

  _closeDoors() {
    var self = this;
    return new Promise(function(resolve) {
      self.state = State.CLOSING;
      self.audio.playCloseSound();

      self.doorLeft.classList.add('closed');
      self.doorRight.classList.add('closed');

      setTimeout(resolve, 1000);
    });
  }

  _openDoors() {
    var self = this;
    return new Promise(function(resolve) {
      self.state = State.OPENING;
      self.audio.playOpenSound();

      self.doorLeft.classList.remove('closed');
      self.doorRight.classList.remove('closed');

      setTimeout(function() {
        self.state = State.IDLE;
        resolve();
      }, 1000);
    });
  }

  /* ----- Movement — Physics Engine ----- */

  /**
   * Build a Trapezoidal Velocity Profile for the trip.
   *
   * Phases:
   *   1. Acceleration: v increases from 0 to vPeak at rate a_max
   *   2. Cruise:       v stays at vPeak (may be 0-length for short trips)
   *   3. Deceleration: v decreases from vPeak to 0 at rate a_max
   *
   * For short trips where totalDist < 2·d_ramp, the elevator never
   * reaches maxSpeed. The peak velocity is: vPeak = √(a·D)
   *
   * @param {number} totalFloors — number of floor transitions
   * @param {number} direction   — +1 (up) or -1 (down)
   * @returns {object} profile — { totalDist, vPeak, tAcc, tCruise, tDec, dAcc, dCruise, totalTime, timeScale }
   */
  _buildMotionProfile(totalFloors, direction) {
    var totalDist = totalFloors * FLOOR_HEIGHT; // meters
    var maxSpeed = direction > 0 ? MAX_SPEED_UP : MAX_SPEED_DOWN;
    var dRamp = (maxSpeed * maxSpeed) / (2 * MAX_ACCEL);
    var dRampTotal = 2 * dRamp;               // accel + decel distance

    var vPeak, tAcc, tCruise, dAcc, dCruise;

    if (totalDist <= dRampTotal) {
      // Short trip: can't reach maxSpeed
      // Each ramp covers half the distance
      dAcc     = totalDist / 2;
      vPeak    = Math.sqrt(2 * MAX_ACCEL * dAcc); // v = √(2·a·d)
      tAcc     = vPeak / MAX_ACCEL;               // t = v/a
      tCruise  = 0;
      dCruise  = 0;
    } else {
      // Long trip: reaches maxSpeed with cruise phase
      vPeak    = maxSpeed;
      dAcc     = dRamp;
      tAcc     = maxSpeed / MAX_ACCEL;            // 2.5s
      dCruise  = totalDist - dRampTotal;
      tCruise  = dCruise / maxSpeed;
    }

    var tDec      = tAcc;  // symmetric deceleration
    var totalTime = tAcc + tCruise + tDec;

    // Time compression for long trips to keep the game playable
    // Physics curve shape is preserved; only playback speed changes
    var timeScale = 1;
    if (totalTime > MAX_TRAVEL_TIME) {
      timeScale = totalTime / MAX_TRAVEL_TIME;
    }

    return {
      totalDist: totalDist,
      vPeak:     vPeak,
      tAcc:      tAcc,
      tCruise:   tCruise,
      tDec:      tDec,
      dAcc:      dAcc,
      dCruise:   dCruise,
      totalTime: totalTime,
      timeScale: timeScale,
      displayTime: totalTime / timeScale  // actual wall-clock seconds
    };
  }

  /**
   * Continuous displacement function d(t) for the trapezoidal profile.
   *
   * Given a profile and elapsed physics-time t (in seconds), returns
   * the distance traveled in meters.
   *
   * Formulas:
   *   Acceleration  (0 ≤ t ≤ tAcc):            d = ½·a·t²
   *   Cruise        (tAcc ≤ t ≤ tAcc+tCruise):  d = dAcc + vPeak·(t−tAcc)
   *   Deceleration  (t > tAcc+tCruise):          d = D − ½·a·(T−t)²
   *
   * @param {object} profile — motion profile from _buildMotionProfile
   * @param {number} t       — elapsed physics time in seconds
   * @returns {number} displacement in meters (clamped to [0, totalDist])
   */
  _getDisplacement(profile, t) {
    if (t <= 0) return 0;
    if (t >= profile.totalTime) return profile.totalDist;

    var tAcc     = profile.tAcc;
    var tCruise  = profile.tCruise;
    var dAcc     = profile.dAcc;
    var totalTime = profile.totalTime;
    var totalDist = profile.totalDist;

    if (t <= tAcc) {
      // Acceleration phase: d = ½·a·t²
      return 0.5 * MAX_ACCEL * t * t;
    }

    var t2 = t - tAcc;
    if (t2 <= tCruise) {
      // Cruise phase: d = dAcc + vPeak·(t − tAcc)
      return dAcc + profile.vPeak * t2;
    }

    // Deceleration phase: d = D − ½·a·(T − t)²
    var remaining = totalTime - t;
    return totalDist - 0.5 * MAX_ACCEL * remaining * remaining;
  }

  /**
   * Get the current instantaneous velocity at physics-time t.
   * Used for dynamic audio intensity.
   *
   * @param {object} profile
   * @param {number} t
   * @returns {number} velocity in m/s
   */
  _getVelocity(profile, t) {
    if (t <= 0 || t >= profile.totalTime) return 0;

    if (t <= profile.tAcc) {
      return MAX_ACCEL * t;  // v = a·t
    }

    var t2 = t - profile.tAcc;
    if (t2 <= profile.tCruise) {
      return profile.vPeak;  // constant speed
    }

    // Deceleration: v = a·(T − t)
    return MAX_ACCEL * (profile.totalTime - t);
  }

  /** Calculate number of floor transitions between two floors (skipping 0) */
  _calcTotalFloors(from, to) {
    var raw = Math.abs(to - from);
    var crossesZero = (from < 0 && to > 0) || (from > 0 && to < 0);
    return crossesZero ? raw - 1 : raw;
  }

  /**
   * Convert a displacement (meters) to floor number, accounting for the
   * skip-zero rule. Returns { wholeFloor, fraction }.
   *
   * @param {number} startFloor  — starting floor number
   * @param {number} direction   — +1 (up) or -1 (down)
   * @param {number} displacement — meters traveled
   * @returns {{ wholeFloor: number, fraction: number }}
   */
  _displacementToFloor(startFloor, direction, displacement) {
    var floorsTraversed = displacement / FLOOR_HEIGHT;
    var wholeFloors = Math.floor(floorsTraversed);
    var fraction = floorsTraversed - wholeFloors;

    // Walk floor-by-floor to handle the skip-zero rule
    var floor = startFloor;
    for (var i = 0; i < wholeFloors; i++) {
      floor += direction;
      if (floor === 0) floor += direction;
    }

    return { wholeFloor: floor, fraction: fraction };
  }

  /**
   * Main movement method — continuous physics-driven animation.
   *
   * Uses requestAnimationFrame for smooth 60fps rendering.
   * The displacement function d(t) drives all visual updates:
   *   - LED floor display
   *   - Shaft strip scrolling (sub-pixel precision)
   *   - Floor-passing beep sounds
   *   - Dynamic motor sound intensity
   */
  async _moveToFloor() {
    this.state = State.MOVING;
    var direction = this.targetFloor > this.currentFloor ? 1 : -1;
    var totalFloors = this._calcTotalFloors(this.currentFloor, this.targetFloor);
    var startFloor = this.currentFloor;

    // Build physics profile
    var profile = this._buildMotionProfile(totalFloors, direction);

    console.log('[Physics] Trip:', startFloor, '→', this.targetFloor,
      '| floors:', totalFloors,
      '| dist:', profile.totalDist.toFixed(1) + 'm',
      '| vPeak:', profile.vPeak.toFixed(2) + 'm/s',
      '| time:', profile.totalTime.toFixed(2) + 's',
      '| timeScale:', profile.timeScale.toFixed(2) + 'x',
      '| displayTime:', profile.displayTime.toFixed(2) + 's');

    // Activate direction arrow
    if (direction > 0) {
      this.arrowUp.classList.add('active');
    } else {
      this.arrowDown.classList.add('active');
    }

    // Start ambient moving sound
    this.audio.startMovingSound();

    // Initialize shaft for continuous scrolling
    this.shaftStrip.style.transition = 'none';

    var self = this;
    var lastDisplayedFloor = startFloor;
    var startTime = null;
    var animFrameId = null;

    await new Promise(function(resolve) {
      function tick(timestamp) {
        if (startTime === null) startTime = timestamp;

        // Elapsed wall-clock time in seconds
        var elapsedWall = (timestamp - startTime) / 1000;

        // Convert to physics time (apply time compression)
        var physicsTime = elapsedWall * profile.timeScale;

        // Clamp to total physics time
        if (physicsTime >= profile.totalTime) {
          physicsTime = profile.totalTime;
        }

        // Get displacement from physics model
        var displacement = self._getDisplacement(profile, physicsTime);

        // Get current velocity for audio
        var velocity = self._getVelocity(profile, physicsTime);
        var normalizedSpeed = velocity / profile.vPeak;
        if (self.audio.setMovingIntensity) {
          self.audio.setMovingIntensity(normalizedSpeed);
        }

        // Convert displacement to floor position
        var pos = self._displacementToFloor(startFloor, direction, displacement);
        var currentWholeFloor = pos.wholeFloor;
        var floorFraction = pos.fraction;

        // Update LED display when floor changes
        if (currentWholeFloor !== lastDisplayedFloor) {
          self.currentFloor = currentWholeFloor;
          self._updateFloorDisplay(currentWholeFloor);
          // self.audio.playFloorBeep(); // Removed passing floor sound as requested
          lastDisplayedFloor = currentWholeFloor;
        }

        // Update shaft strip with sub-pixel scrolling
        self._updateShaftContinuous(currentWholeFloor, direction, floorFraction);

        // Check if animation is complete
        if (physicsTime >= profile.totalTime) {
          // Ensure we land exactly on the target floor
          self.currentFloor = self.targetFloor;
          self._updateFloorDisplay(self.targetFloor);
          self._updateShaft(self.targetFloor);
          self.shaftStrip.style.transform = 'translateY(-' + SLOT_HEIGHT + 'px)';
          resolve();
          return;
        }

        animFrameId = requestAnimationFrame(tick);
      }

      animFrameId = requestAnimationFrame(tick);
    });

    // Stop sounds & arrows
    this.audio.stopMovingSound();
    this.arrowUp.classList.remove('active');
    this.arrowDown.classList.remove('active');

    // Arrival
    this.state = State.ARRIVING;
    this.audio.playArrivalDing();
    await this._delay(600);
  }

  /* ----- Continuous Shaft Scroll ----- */

  /**
   * Update shaft strip position for continuous scrolling.
   *
   * Instead of animating one-slot jumps, we compute the exact sub-pixel
   * offset based on the fractional floor position and apply it directly.
   *
   * @param {number} wholeFloor — current whole floor number
   * @param {number} direction  — +1 (up) or -1 (down)
   * @param {number} fraction   — fractional progress toward next floor [0, 1)
   */
  _updateShaftContinuous(wholeFloor, direction, fraction) {
    // Update slot labels centered on current whole floor
    this._updateShaft(wholeFloor);

    // Calculate sub-pixel offset
    // Base offset hides the top buffer slot: -SLOT_HEIGHT
    // Additional offset based on fraction of floor traversed
    var subOffset = fraction * SLOT_HEIGHT * direction;
    var baseOffset = -SLOT_HEIGHT;
    // Fix: when going UP (direction=1), strip should scroll DOWN (offset moves from -46 towards 0)
    var totalOffset = baseOffset + subOffset;

    this.shaftStrip.style.transform = 'translateY(' + totalOffset + 'px)';
  }

  /** Get the next floor in the given direction, skipping 0 */
  _nextFloor(floor, direction) {
    var next = floor + direction;
    if (next === 0) next += direction;
    return next;
  }

  /* ----- Display Update ----- */

  _updateFloorDisplay(floor) {
    var str = this._formatFloorDisplay(floor);
    var padded = str.padStart(3, ' ');
    var d1 = document.getElementById('digit-1');
    var d2 = document.getElementById('digit-2');
    var d3 = document.getElementById('digit-3');
    if (d1) d1.textContent = padded.charAt(0) === ' ' ? '\u00A0' : padded.charAt(0);
    if (d2) d2.textContent = padded.charAt(1) === ' ' ? '\u00A0' : padded.charAt(1);
    if (d3) d3.textContent = padded.charAt(2) === ' ' ? '\u00A0' : padded.charAt(2);
  }

  /* ----- Utility ----- */
  _delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }
}

/* ===== Bootstrap ===== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    window.elevatorGame = new ElevatorGame();
  });
} else {
  window.elevatorGame = new ElevatorGame();
}
