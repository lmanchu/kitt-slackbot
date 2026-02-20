/**
 * Tests for Skills Registry
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

/**
 * Test: Registry can be required without errors
 */
function testRegistryImport() {
  try {
    const registry = require('../../src/skills/registry');
    if (typeof registry.loadSkills === 'function') {
      console.log('✅ Registry import test passed');
      return true;
    } else {
      console.error('❌ Registry import test failed: loadSkills is not a function');
      return false;
    }
  } catch (error) {
    console.error('❌ Registry import test failed:', error.message);
    return false;
  }
}

/**
 * Test: loadSkills function handles empty skills directory
 */
function testEmptySkillsDirectory() {
  mockConsole();
  
  // Mock app object
  const mockApp = {
    message: () => {},
    event: () => {},
    command: () => {}
  };
  
  try {
    loadSkills(mockApp);
    
    // Should not throw errors with empty directory
    restoreConsole();
    console.log('✅ Empty skills directory test passed');
    return true;
  } catch (error) {
    restoreConsole();
    console.error('❌ Empty skills directory test failed:', error.message);
    return false;
  } finally {
    clearConsoleOutput();
  }
}

/**
 * Test: Registry follows Node.js module conventions
 */
function testModuleConventions() {
  const registryPath = path.join(__dirname, '../../src/skills/registry.js');
  
  if (!fs.existsSync(registryPath)) {
    console.error('❌ Module conventions test failed: registry.js not found');
    return false;
  }
  
  const content = fs.readFileSync(registryPath, 'utf8');
  
  // Check for module.exports
  if (!content.includes('module.exports')) {
    console.error('❌ Module conventions test failed: missing module.exports');
    return false;
  }
  
  // Check for proper function export
  if (!content.includes('loadSkills')) {
    console.error('❌ Module conventions test failed: loadSkills function not found');
    return false;
  }
  
  console.log('✅ Module conventions test passed');
  return true;
}

/**
 * Test: Directory structure is correct
 */
function testDirectoryStructure() {
  const skillsDir = path.join(__dirname, '../../src/skills');
  
  if (!fs.existsSync(skillsDir)) {
    console.error('❌ Directory structure test failed: src/skills directory not found');
    return false;
  }
  
  if (!fs.statSync(skillsDir).isDirectory()) {
    console.error('❌ Directory structure test failed: src/skills is not a directory');
    return false;
  }
  
  console.log('✅ Directory structure test passed');
  return true;
}

// Run all tests
function runTests() {
  console.log('Running Skills Registry Tests...\n');
  
  const tests = [
    testDirectoryStructure,
    testRegistryImport,
    testModuleConventions,
    testEmptySkillsDirectory
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    if (test()) {
      passed++;
    }
  }
  
  console.log(`\nTest Results: ${passed}/${total} passed`);
  return passed === total;
}

module.exports = {
  runTests,
  testRegistryImport,
  testEmptySkillsDirectory,
  testModuleConventions,
  testDirectoryStructure
};