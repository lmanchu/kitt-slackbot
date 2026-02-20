/**
 * Skills Registry
 * Manages skill loading and registration for KITT
 */

const fs = require('fs');
const path = require('path');

/**
 * Load all skills from subdirectories and register them with the app
 * @param {Object} app - The Slack Bolt app instance
 */
function loadSkills(app) {
  const skillsDir = __dirname;
  
  // Read all directories in the skills folder
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.' && entry.name !== '..') {
        const skillDir = path.join(skillsDir, entry.name);
        const skillIndexPath = path.join(skillDir, 'index.js');
        
        // Check if skill has an index.js file
        if (fs.existsSync(skillIndexPath)) {
          try {
            console.log(`[Skills] Loading skill: ${entry.name}`);
            
            // Require the skill module
            const skill = require(skillIndexPath);
            
            // Check if skill has a register function
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
}

module.exports = {
  loadSkills
};