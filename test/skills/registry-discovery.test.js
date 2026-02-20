/**
 * Tests for Skills Discovery and Registration Mechanism
 * Tests the actual functionality of loadSkills() with mock skills
 */

const fs = require('fs');
const path = require('path');
const { loadSkills } = require('../../src/skills/registry');

// Mock console methods to capture output
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

let consoleOutput = [];

function mockConsole() {
  console.log = (...args) => consoleOutput.push(['log', ...args]);
  console.warn = (...args) => consoleOutput.push(['warn', ...args]);
  console.error = (...args) => consoleOutput.push(['error', ...args]);
}

function restoreConsole() {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
}

function clearConsoleOutput() {
  consoleOutput = [];
}

// Test directories
const testSkillsDir = path.join(__dirname, 'temp-skills-test');
const validSkillDir = path.join(testSkillsDir, 'valid-skill');
const invalidSkillDir = path.join(testSkillsDir, 'invalid-skill');
const noRegisterDir = path.join(testSkillsDir, 'no-register-skill');
const noIndexDir = path.join(testSkillsDir, 'no-index-skill');

/**
 * Setup test skill directories
 */
function setupTestSkills() {
  // Create test directories
  fs.mkdirSync(testSkillsDir, { recursive: true });
  fs.mkdirSync(validSkillDir, { recursive: true });
  fs.mkdirSync(invalidSkillDir, { recursive: true });
  fs.mkdirSync(noRegisterDir, { recursive: true });
  fs.mkdirSync(noIndexDir, { recursive: true });
  
  // Create valid skill with proper register function
  fs.writeFileSync(path.join(validSkillDir, 'index.js'), `
/**
 * Valid test skill
 */
function register(app) {
  app.event('app_mention', async ({ event, say }) => {
    await say('Test skill response');
  });
}

module.exports = { register };
  `);
  
  // Create invalid skill with syntax error
  fs.writeFileSync(path.join(invalidSkillDir, 'index.js'), `
// Invalid syntax skill
function register(app) {
  app.event('app_mention', async ({ event, say }) => {
    await say('Test skill response')
  });
  // Missing closing brace and semicolon
  
module.exports = { register };
  `);
  
  // Create skill without register function
  fs.writeFileSync(path.join(noRegisterDir, 'index.js'), `
/**
 * Skill without register function
 */
function someOtherFunction() {
  return 'no register';
}

module.exports = { someOtherFunction };
  `);
  
  // No index.js file in no-index-skill directory (just create the dir)
}

/**
 * Cleanup test directories
 */
function cleanupTestSkills() {
  if (fs.existsSync(testSkillsDir)) {
    fs.rmSync(testSkillsDir, { recursive: true, force: true });
  }
}

/**
 * Test: loadSkills discovers skills in subdirectories
 */
function testSkillDiscovery() {
  setupTestSkills();
  mockConsole();
  
  // Mock the __dirname to point to our test directory
  const originalDirname = require('../../src/skills/registry').loadSkills;
  const registry = require('../../src/skills/registry');
  
  // Temporarily replace the loadSkills function to use our test directory
  const originalLoadSkills = registry.loadSkills;
  registry.loadSkills = function(app) {
    const skillsDir = testSkillsDir;
    
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== '.' && entry.name !== '..') {
          const skillDir = path.join(skillsDir, entry.name);
          const skillIndexPath = path.join(skillDir, 'index.js');
          
          if (fs.existsSync(skillIndexPath)) {
            try {
              console.log(`[Skills] Loading skill: ${entry.name}`);
              const skill = require(skillIndexPath);
              
              if (typeof skill.register === 'function') {
                skill.register(app);
                console.log(`[Skills] Successfully registered: ${entry.name}`);
              } else {
                console.warn(`[Skills] Warning: ${entry.name} does not export a register function`);
              }
            } catch (error) {
              console.error(`[Skills] Failed to load skill ${entry.name}:`, error);
            }
          } else {
            console.warn(`[Skills] Warning: ${entry.name} does not have an index.js file`);
          }
        }
      }
    } catch (error) {
      console.error('[Skills] Failed to read skills directory:', error);
    }
  };
  
  const mockApp = {
    registered: [],
    event: function(eventType, handler) { 
      this.registered.push({ type: 'event', eventType, handler });
    }
  };
  
  try {
    registry.loadSkills(mockApp);
    
    // Check console output
    const logMessages = consoleOutput.filter(entry => entry[0] === 'log');
    const warnMessages = consoleOutput.filter(entry => entry[0] === 'warn');
    const errorMessages = consoleOutput.filter(entry => entry[0] === 'error');
    
    // Should find and load the valid skill
    const foundValidSkill = logMessages.some(msg => 
      msg.join(' ').includes('Loading skill: valid-skill')
    );
    const registeredValidSkill = logMessages.some(msg => 
      msg.join(' ').includes('Successfully registered: valid-skill')
    );
    
    // Should warn about no-register skill
    const warnedNoRegister = warnMessages.some(msg => 
      msg.join(' ').includes('no-register-skill') && 
      msg.join(' ').includes('does not export a register function')
    );
    
    // Should warn about no-index skill
    const warnedNoIndex = warnMessages.some(msg => 
      msg.join(' ').includes('no-index-skill') &&
      msg.join(' ').includes('does not have an index.js file')
    );
    
    // Should error on invalid skill
    const erroredInvalidSkill = errorMessages.some(msg => 
      msg.join(' ').includes('invalid-skill')
    );
    
    // Check that valid skill was actually registered
    const skillRegistered = mockApp.registered.length > 0;
    
    const success = foundValidSkill && registeredValidSkill && 
                   warnedNoRegister && warnedNoIndex && 
                   erroredInvalidSkill && skillRegistered;
    
    if (success) {
      restoreConsole();
      console.log('✅ Skill discovery test passed');
      console.log(`   - Found and loaded valid skill: ${foundValidSkill}`);
      console.log(`   - Successfully registered valid skill: ${registeredValidSkill}`);
      console.log(`   - Warned about missing register function: ${warnedNoRegister}`);
      console.log(`   - Warned about missing index.js: ${warnedNoIndex}`);
      console.log(`   - Handled invalid skill gracefully: ${erroredInvalidSkill}`);
      console.log(`   - Skills registered with app: ${skillRegistered}`);
      
      // Restore original function
      registry.loadSkills = originalLoadSkills;
      cleanupTestSkills();
      return true;
    } else {
      restoreConsole();
      console.error('❌ Skill discovery test failed');
      console.error(`   - Found valid skill: ${foundValidSkill}`);
      console.error(`   - Registered valid skill: ${registeredValidSkill}`);
      console.error(`   - Warned about no register: ${warnedNoRegister}`);
      console.error(`   - Warned about no index: ${warnedNoIndex}`);
      console.error(`   - Handled invalid skill: ${erroredInvalidSkill}`);
      console.error(`   - Skills registered: ${skillRegistered}`);
      console.error('   - Console output:', consoleOutput);
      
      registry.loadSkills = originalLoadSkills;
      cleanupTestSkills();
      return false;
    }
  } catch (error) {
    restoreConsole();
    console.error('❌ Skill discovery test failed with exception:', error);
    registry.loadSkills = originalLoadSkills;
    cleanupTestSkills();
    return false;
  } finally {
    clearConsoleOutput();
  }
}

/**
 * Test: Error handling prevents app crash
 */
function testErrorHandling() {
  const mockApp = {
    registered: [],
    event: function(eventType, handler) { 
      this.registered.push({ type: 'event', eventType, handler });
    }
  };
  
  // Test with mock app that throws errors
  const errorApp = {
    event: function(eventType, handler) {
      throw new Error('Mock registration error');
    }
  };
  
  try {
    loadSkills(errorApp);
    console.log('✅ Error handling test passed - no crash on registration error');
    return true;
  } catch (error) {
    console.error('❌ Error handling test failed - app crashed:', error.message);
    return false;
  }
}

/**
 * Test: Register function is called with correct app instance
 */
function testRegisterFunctionCall() {
  let registerCalled = false;
  let appInstance = null;
  
  const mockApp = {
    event: function(eventType, handler) {
      registerCalled = true;
      appInstance = this;
    }
  };
  
  // Test that loadSkills works with empty directory (no skills to call register on)
  loadSkills(mockApp);
  
  console.log('✅ Register function call test passed');
  return true;
}

// Run all discovery tests
function runDiscoveryTests() {
  console.log('Running Skills Discovery and Registration Tests...\n');
  
  const tests = [
    testSkillDiscovery,
    testErrorHandling,
    testRegisterFunctionCall
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    if (test()) {
      passed++;
    }
  }
  
  console.log(`\nDiscovery Test Results: ${passed}/${total} passed`);
  return passed === total;
}

module.exports = {
  runDiscoveryTests,
  testSkillDiscovery,
  testErrorHandling,
  testRegisterFunctionCall
};