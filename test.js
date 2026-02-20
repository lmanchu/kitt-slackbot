#!/usr/bin/env node
/**
 * Basic test suite for KITT Slack Bot
 */

console.log('🧪 Running KITT tests...');

// Test 0: Run Skills Registry tests
try {
  const { runTests } = require('./test/skills/registry.test.js');
  const skillsTestsPass = runTests();
  if (!skillsTestsPass) {
    console.error('❌ Skills Registry tests failed');
    process.exit(1);
  }
  console.log(''); // Add spacing
} catch (error) {
  console.error('❌ Skills Registry tests failed to run:', error.message);
  process.exit(1);
}

// Test 1: Check if main bot file exists and is valid JS
try {
  require('./bot.js');
  console.log('✅ bot.js loads without syntax errors');
} catch (error) {
  console.error('❌ bot.js failed to load:', error.message);
  process.exit(1);
}

// Test 2: Check if package.json is valid
try {
  const pkg = require('./package.json');
  console.log('✅ package.json is valid');
  console.log(`   - Version: ${pkg.version}`);
  console.log(`   - Dependencies: ${Object.keys(pkg.dependencies || {}).length}`);
} catch (error) {
  console.error('❌ package.json is invalid:', error.message);
  process.exit(1);
}

// Test 3: Check if required environment variables are documented
try {
  const fs = require('fs');
  if (fs.existsSync('.env.example') || fs.existsSync('.env.template')) {
    console.log('✅ Environment template exists');
  } else {
    console.log('⚠️  No .env.example or .env.template found');
  }
} catch (error) {
  console.log('⚠️  Could not check environment templates');
}

// Test 4: Check skills registry functionality
try {
  const { loadSkills } = require('./src/skills/registry.js');
  
  if (typeof loadSkills === 'function') {
    console.log('✅ Skills registry exports loadSkills function');
    
    // Create a mock app to test registration
    const mockApp = {
      registered: [],
      event: function(eventType, handler) { 
        this.registered.push({ type: 'event', eventType, handler });
      },
      message: function(pattern, handler) { 
        this.registered.push({ type: 'message', pattern, handler });
      },
      action: function(actionId, handler) { 
        this.registered.push({ type: 'action', actionId, handler });
      }
    };
    
    // Test loadSkills doesn't throw
    loadSkills(mockApp);
    console.log('✅ Skills registry loadSkills() executes without errors');
    
  } else {
    console.error('❌ Skills registry does not export loadSkills function');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Skills registry test failed:', error.message);
  process.exit(1);
}

// Test 5: Check directory structure follows Node.js conventions
try {
  const fs = require('fs');
  const path = require('path');
  
  // Check that src/skills exists
  if (fs.existsSync('src/skills')) {
    console.log('✅ src/skills directory exists');
    
    // Check registry.js exists
    if (fs.existsSync('src/skills/registry.js')) {
      console.log('✅ src/skills/registry.js exists');
    } else {
      console.error('❌ src/skills/registry.js is missing');
      process.exit(1);
    }
  } else {
    console.error('❌ src/skills directory is missing');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Directory structure test failed:', error.message);
  process.exit(1);
}

console.log('🎉 All tests passed!');
console.log('');
console.log('Skills Registry Tests Completed:');
console.log('✅ Directory structure follows Node.js conventions');
console.log('✅ registry.js exists with loadSkills() function');
console.log('✅ loadSkills() executes without errors');
console.log('');
console.log('Note: Consider adding more comprehensive tests for:');
console.log('- Slack API integration');
console.log('- Database operations');
console.log('- AI provider connections');
console.log('- Individual skill functionality');