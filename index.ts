/**
 * HYTOPIA SDK Boilerplate
 * 
 * This is a simple boilerplate to get started on your project.
 * It implements the bare minimum to be able to run and connect
 * to your game server and run around as the basic player entity.
 * 
 * From here you can begin to implement your own game logic
 * or do whatever you want!
 * 
 * You can find documentation here: https://github.com/hytopiagg/sdk/blob/main/docs/server.md
 * 
 * For more in-depth examples, check out the examples folder in the SDK, or you
 * can find it directly on GitHub: https://github.com/hytopiagg/sdk/tree/main/examples/payload-game
 * 
 * You can officially report bugs or request features here: https://github.com/hytopiagg/sdk/issues
 * 
 * To get help, have found a bug, or want to chat with
 * other HYTOPIA devs, join our Discord server:
 * https://discord.gg/DXCXJbHSJX
 * 
 * Official SDK Github repo: https://github.com/hytopiagg/sdk
 * Official SDK NPM Package: https://www.npmjs.com/package/hytopia
 */

import {
  startServer,
  Audio,
  DefaultPlayerEntity,
  PlayerEvent,
  EntityEvent,
  type Vector3Like,
  Quaternion,
} from 'hytopia';

import worldMap from './assets/map.json';

/**
 * startServer is always the entry point for our game.
 * It accepts a single function where we should do any
 * setup necessary for our game. The init function is
 * passed a World instance which is the default
 * world created by the game server on startup.
 * 
 * Documentation: https://github.com/hytopiagg/sdk/blob/main/docs/server.startserver.md
 */

startServer(world => {
  /**
   * Enable debug rendering of the physics simulation.
   * This will overlay lines in-game representing colliders,
   * rigid bodies, and raycasts. This is useful for debugging
   * physics-related issues in a development environment.
   * Enabling this can cause performance issues, which will
   * be noticed as dropped frame rates and higher RTT times.
   * It is intended for development environments only and
   * debugging physics.
   */
  
  // world.simulation.enableDebugRendering(true);

  /**
   * Load our map.
   * You can build your own map using https://build.hytopia.com
   * After building, hit export and drop the .json file in
   * the assets folder as map.json.
   */
  world.loadMap(worldMap);

  /**
   * Handle player joining the game. The PlayerEvent.JOINED_WORLD
   * event is emitted to the world when a new player connects to
   * the game. From here, we create a basic player
   * entity instance which automatically handles mapping
   * their inputs to control their in-game entity and
   * internally uses our player entity controller.
   * 
   * The HYTOPIA SDK is heavily driven by events, you
   * can find documentation on how the event system works,
   * here: https://dev.hytopia.com/sdk-guides/events
   */
  // Find all checkpoint blocks (orange concrete, ID 6) from the map
  const ORANGE_CONCRETE_BLOCK_ID = 6;
  const checkpointBlocks: Vector3Like[] = [];
  const checkpointBlockCoords: Vector3Like[] = []; // Store actual block coordinates
  const checkpointCoordToIndex: Map<string, number> = new Map(); // Map block coordinates to checkpoint index
  
  // Find all yellow arrow blocks (ID 7) from the map for conveyor belt effect
  const YELLOW_ARROW_BLOCK_ID = 7;
  const yellowArrowBlocks: Vector3Like[] = []; // Store yellow arrow block coordinates
  
  // Parse map to find all orange concrete blocks and yellow arrow blocks
  const blocks = worldMap.blocks;
  for (const [coord, blockId] of Object.entries(blocks)) {
    if (blockId === ORANGE_CONCRETE_BLOCK_ID) {
      const [x, y, z] = coord.split(',').map(Number);
      checkpointBlockCoords.push({ x, y, z }); // Store actual block coordinate
      checkpointBlocks.push({ x, y: y + 1, z }); // y + 1 to place player on top of block
    } else if (blockId === YELLOW_ARROW_BLOCK_ID) {
      const [x, y, z] = coord.split(',').map(Number);
      yellowArrowBlocks.push({ x, y, z }); // Store yellow arrow block coordinate
    }
  }
  
  // Sort checkpoints by progression (order by z-coordinate, then x-coordinate)
  // This determines the sequence of checkpoints
  // Sort both arrays together to keep them in sync
  const checkpointPairs = checkpointBlockCoords.map((blockCoord, i) => ({
    blockCoord,
    spawnPos: checkpointBlocks[i],
    coord: `${blockCoord.x},${blockCoord.y},${blockCoord.z}`
  }));
  checkpointPairs.sort((a, b) => {
    if (Math.abs(a.blockCoord.z - b.blockCoord.z) > 0.5) {
      return a.blockCoord.z - b.blockCoord.z; // Primary sort by z-coordinate
    }
    return a.blockCoord.x - b.blockCoord.x; // Secondary sort by x-coordinate
  });
  
  // Rebuild arrays in sorted order and create coordinate lookup map
  checkpointBlockCoords.length = 0;
  checkpointBlocks.length = 0;
  checkpointPairs.forEach((pair, index) => {
    checkpointBlockCoords.push(pair.blockCoord);
    checkpointBlocks.push(pair.spawnPos);
    checkpointCoordToIndex.set(pair.coord, index); // Map coordinate to sorted index
  });
  
  // Helper function to find which checkpoint a position is closest to
  const findCheckpointIndex = (position: Vector3Like): number => {
    let closestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < checkpointBlocks.length; i++) {
      const checkpoint = checkpointBlocks[i];
      const distance = Math.sqrt(
        Math.pow(checkpoint.x - position.x, 2) +
        Math.pow(checkpoint.z - position.z, 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }
    
    return closestIndex;
  };
  
  // Helper function to find which checkpoint block a position is at
  // Checks if player is actually standing on top of the checkpoint block
  const findCheckpointAtPosition = (position: Vector3Like): number | null => {
    for (let i = 0; i < checkpointBlockCoords.length; i++) {
      const blockCoord = checkpointBlockCoords[i];
      // Check if player's x and z coordinates are within the block (0.5 block radius from center)
      const dx = Math.abs(position.x - (blockCoord.x + 0.5));
      const dz = Math.abs(position.z - (blockCoord.z + 0.5));
      
      // Player must be within the block's horizontal bounds
      if (dx < 0.5 && dz < 0.5) {
        // Check if player is on top of or slightly above the block
        const blockTop = blockCoord.y + 1;
        if (position.y >= blockCoord.y && position.y < blockTop + 2) {
          return i;
        }
      }
    }
    
    return null;
  };

  world.on(PlayerEvent.JOINED_WORLD, async ({ player }) => {
    // Load saved checkpoint position or use first checkpoint
    const playerData = await player.getPersistedData();
    let checkpointPosition: Vector3Like;
    let currentCheckpointIndex: number;
    
    if (playerData && playerData.checkpointPosition && checkpointBlocks.length > 0) {
      const savedCheckpoint = playerData.checkpointPosition as Vector3Like;
      // Validate the saved checkpoint has valid coordinates
      if (typeof savedCheckpoint.x === 'number' && 
          typeof savedCheckpoint.y === 'number' && 
          typeof savedCheckpoint.z === 'number') {
        // Find which checkpoint this position corresponds to
        const savedIndex = findCheckpointIndex(savedCheckpoint);
        // Validate the saved position is actually close to a checkpoint
        const savedCheckpointPos = checkpointBlocks[savedIndex];
        const distance = Math.sqrt(
          Math.pow(savedCheckpoint.x - savedCheckpointPos.x, 2) +
          Math.pow(savedCheckpoint.z - savedCheckpointPos.z, 2)
        );
        // If saved position is within 5 blocks of a checkpoint, use it
        if (distance < 5 && savedIndex < checkpointBlocks.length) {
          checkpointPosition = savedCheckpointPos; // Use the actual checkpoint position
          currentCheckpointIndex = savedIndex;
        } else {
          // Invalid saved position, use first checkpoint
          checkpointPosition = checkpointBlocks[0];
          currentCheckpointIndex = 0;
        }
      } else {
        // Invalid saved data, use first checkpoint
        checkpointPosition = checkpointBlocks[0];
        currentCheckpointIndex = 0;
      }
    } else {
      // No saved checkpoint, use first checkpoint
      if (checkpointBlocks.length > 0) {
        checkpointPosition = checkpointBlocks[0];
        currentCheckpointIndex = 0;
      } else {
        // Fallback if no checkpoints exist
        checkpointPosition = { x: 0, y: 10, z: 0 };
        currentCheckpointIndex = 0;
      }
    }
    
    // Find next checkpoint for rotation (if not at last checkpoint)
    let nearestCheckpoint: Vector3Like | null = null;
    if (currentCheckpointIndex < checkpointBlocks.length - 1) {
      nearestCheckpoint = checkpointBlocks[currentCheckpointIndex + 1];
    } else if (currentCheckpointIndex > 0) {
      // If at last checkpoint, face backwards
      nearestCheckpoint = checkpointBlocks[currentCheckpointIndex - 1];
    }
    
    // Calculate rotation to face nearest checkpoint
    let spawnRotation: Quaternion | undefined;
    if (nearestCheckpoint) {
      const dx = nearestCheckpoint.x - checkpointPosition.x;
      const dz = nearestCheckpoint.z - checkpointPosition.z;
      // Calculate yaw angle (rotation around Y axis)
      // -z is forward in Hytopia, so we use atan2(-dx, -dz)
      const yaw = Math.atan2(-dx, -dz) * (180 / Math.PI); // Convert to degrees
      spawnRotation = Quaternion.fromEuler(0, yaw, 0);
    }
    
    const playerEntity = new DefaultPlayerEntity({
      player,
      name: 'Player',
    });
  
    playerEntity.spawn(world, checkpointPosition, spawnRotation);

    // Ensure camera is attached to the player entity
    // (DefaultPlayerEntity should do this automatically, but explicitly setting it ensures it works)
    player.camera.setAttachedToEntity(playerEntity);

    // Load our game UI for this player
    player.ui.load('ui/index.html');

    // Send a nice welcome message that only the player who joined will see ;)
    world.chatManager.sendPlayerMessage(player, 'Welcome to the game!', '00FF00');
    world.chatManager.sendPlayerMessage(player, 'Use WASD to move around & space to jump.');
    world.chatManager.sendPlayerMessage(player, 'Hold shift to sprint.');
    world.chatManager.sendPlayerMessage(player, 'Touch orange concrete blocks to set checkpoints!', 'FFA500');
    world.chatManager.sendPlayerMessage(player, 'Press \\ to enter or exit debug view.');

    // Lava block type id (from map.json)
    const LAVA_BLOCK_ID = 5;

    // Store current checkpoint position (will be updated when new checkpoint is set)
    let currentCheckpointPosition: Vector3Like = checkpointPosition;
    
    // Function to update progress UI
    const updateProgressUI = () => {
      const totalStages = checkpointBlocks.length;
      // Stage number: current checkpoint index + 1 (starts at 1)
      const currentStage = currentCheckpointIndex + 1;
      
      // Percentage: calculate based on progress from first checkpoint (0%) to last checkpoint (100%)
      // If there's only 1 checkpoint, you're at 100%
      let percentage = 0;
      if (totalStages === 1) {
        percentage = 100;
      } else if (totalStages > 1) {
        // Progress from checkpoint 0 (0%) to last checkpoint (100%)
        percentage = (currentCheckpointIndex / (totalStages - 1)) * 100;
      }
      
      // Ensure percentage doesn't exceed 100
      percentage = Math.min(100, Math.max(0, percentage));
      
      player.ui.sendData({
        type: 'progress-update',
        stage: currentStage,
        percentage: percentage
      });
    };
    
    // Send initial progress after UI is loaded (delay to ensure UI is ready)
    setTimeout(() => {
      updateProgressUI();
    }, 500);

    // Helper function to respawn player at checkpoint
    const respawnAtCheckpoint = () => {
      // Find next checkpoint for rotation (if not at last checkpoint)
      let nearestCheckpoint: Vector3Like | null = null;
      if (currentCheckpointIndex < checkpointBlocks.length - 1) {
        nearestCheckpoint = checkpointBlocks[currentCheckpointIndex + 1];
      } else if (currentCheckpointIndex > 0) {
        // If at last checkpoint, face backwards
        nearestCheckpoint = checkpointBlocks[currentCheckpointIndex - 1];
      }
      
      // Calculate rotation to face nearest checkpoint
      let respawnRotation: Quaternion | undefined;
      if (nearestCheckpoint) {
        const dx = nearestCheckpoint.x - currentCheckpointPosition.x;
        const dz = nearestCheckpoint.z - currentCheckpointPosition.z;
        const yaw = Math.atan2(-dx, -dz) * (180 / Math.PI);
        respawnRotation = Quaternion.fromEuler(0, yaw, 0);
      }
      
      // Respawn player at checkpoint
      playerEntity.setPosition(currentCheckpointPosition);
      if (respawnRotation) {
        playerEntity.setRotation(respawnRotation);
      }
      playerEntity.setLinearVelocity({ x: 0, y: 0, z: 0 });
    };

    // Set up checkpoint system - detect when player touches orange concrete
    playerEntity.on(EntityEvent.BLOCK_COLLISION, ({ blockType, started }) => {
      // Check if the collision is with orange concrete and collision just started
      if (blockType.id === ORANGE_CONCRETE_BLOCK_ID && started) {
        const playerPosition = playerEntity.position;
        
        // Find the nearest checkpoint block to the player
        let touchedCheckpointIndex: number | null = null;
        let minDistance = Infinity;
        
        for (let i = 0; i < checkpointBlockCoords.length; i++) {
          const blockCoord = checkpointBlockCoords[i];
          // Calculate distance from player to checkpoint block center
          const distance = Math.sqrt(
            Math.pow(playerPosition.x - (blockCoord.x + 0.5), 2) +
            Math.pow(playerPosition.z - (blockCoord.z + 0.5), 2)
          );
          
          // If player is within 1.5 blocks of the checkpoint block center, they're touching it
          if (distance < 1.5 && distance < minDistance) {
            minDistance = distance;
            touchedCheckpointIndex = i;
          }
        }
        
        if (touchedCheckpointIndex === null) {
          // Player is not close enough to any checkpoint block
          return;
        }
        
        // Check if this is the current checkpoint or the immediate next checkpoint
        const isCurrentCheckpoint = touchedCheckpointIndex === currentCheckpointIndex;
        const isNextCheckpoint = touchedCheckpointIndex === currentCheckpointIndex + 1;
        
        if (isCurrentCheckpoint) {
          // Player is on their current checkpoint - allow saving to refresh it
          const newCheckpointPosition = checkpointBlocks[touchedCheckpointIndex];
          currentCheckpointPosition = newCheckpointPosition;
          player.setPersistedData({ checkpointPosition: newCheckpointPosition });
          world.chatManager.sendPlayerMessage(player, 'Checkpoint saved!', '00FF00');
          // Update UI immediately
          updateProgressUI();
        } else if (isNextCheckpoint) {
          // Player is on the next checkpoint - allow saving to progress
          const newCheckpointPosition = checkpointBlocks[touchedCheckpointIndex];
          currentCheckpointPosition = newCheckpointPosition;
          currentCheckpointIndex = touchedCheckpointIndex;
          player.setPersistedData({ checkpointPosition: newCheckpointPosition });
          world.chatManager.sendPlayerMessage(player, 'Checkpoint saved!', '00FF00');
          // Update UI immediately after index is updated
          updateProgressUI();
        } else if (touchedCheckpointIndex < currentCheckpointIndex) {
          // Player tried to save a checkpoint that comes before their current one
          world.chatManager.sendPlayerMessage(player, 'You cannot go back to a previous checkpoint!', 'FF0000');
        } else {
          // Player tried to save a checkpoint that is not the immediate next one
          world.chatManager.sendPlayerMessage(player, 'You must reach checkpoints in order!', 'FF0000');
        }
      }
      
      // Check if the collision is with lava and collision just started
      if (blockType.id === LAVA_BLOCK_ID && started) {
        world.chatManager.sendPlayerMessage(player, 'You touched lava! Respawning at checkpoint...', 'FF0000');
        respawnAtCheckpoint();
      }
    });

    // Set up fall detection and respawn system
    // If player falls more than 50 blocks below their checkpoint, respawn them
    const FALL_THRESHOLD = 50;
    
    playerEntity.on(EntityEvent.UPDATE_POSITION, ({ position }) => {
      // Check if player has fallen too far below their checkpoint position
      if (position.y < currentCheckpointPosition.y - FALL_THRESHOLD) {
        world.chatManager.sendPlayerMessage(player, 'You fell off the map! Respawning at checkpoint...', 'FF0000');
        respawnAtCheckpoint();
      }
      
      // Check if player is on a yellow arrow block (conveyor belt)
      let isOnConveyorBelt = false;
      let conveyorDirection: Vector3Like | null = null;
      
      for (const arrowBlock of yellowArrowBlocks) {
        // Check if player is on top of this arrow block
        const dx = Math.abs(position.x - (arrowBlock.x + 0.5));
        const dz = Math.abs(position.z - (arrowBlock.z + 0.5));
        const dy = position.y - arrowBlock.y;
        
        // Player must be within the block's horizontal bounds and on top of it
        if (dx < 0.6 && dz < 0.6 && dy >= 0.5 && dy < 2.5) {
          isOnConveyorBelt = true;
          // Arrow points in +Z direction (forward), so conveyor pushes in that direction
          conveyorDirection = { x: 0, y: 0, z: 1 };
          break;
        }
      }
      
      // Apply conveyor belt effect
      if (isOnConveyorBelt && conveyorDirection) {
        const velocity = playerEntity.linearVelocity;
        
        // Conveyor belt speed (moderate force)
        const conveyorSpeed = 2.0;
        
        // Apply force in the conveyor direction
        const forceX = conveyorDirection.x * conveyorSpeed;
        const forceZ = conveyorDirection.z * conveyorSpeed;
        
        // Apply the conveyor force
        playerEntity.applyImpulse({ x: forceX * 0.1, y: 0, z: forceZ * 0.1 });
        
        // Apply friction when walking against the conveyor direction
        // Calculate velocity component against the conveyor
        const velocityAgainstConveyor = velocity.x * -conveyorDirection.x + velocity.z * -conveyorDirection.z;
        
        if (velocityAgainstConveyor > 0.1) {
          // Player is walking against the conveyor - apply friction
          const frictionStrength = 0.4; // Moderate friction
          const frictionX = -velocity.x * frictionStrength * 0.1;
          const frictionZ = -velocity.z * frictionStrength * 0.1;
          
          playerEntity.applyImpulse({ x: frictionX, y: 0, z: frictionZ });
        }
      }
    });
  });

  /**
   * Handle player leaving the game. The PlayerEvent.LEFT_WORLD
   * event is emitted to the world when a player leaves the game.
   * Because HYTOPIA is not opinionated on join and
   * leave game logic, we are responsible for cleaning
   * up the player and any entities associated with them
   * after they leave. We can easily do this by 
   * getting all the known PlayerEntity instances for
   * the player who left by using our world's EntityManager
   * instance.
   * 
   * The HYTOPIA SDK is heavily driven by events, you
   * can find documentation on how the event system works,
   * here: https://dev.hytopia.com/sdk-guides/events
   */
  world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
    world.entityManager.getPlayerEntitiesByPlayer(player).forEach(entity => entity.despawn());
  });

  /**
   * A silly little easter egg command. When a player types
   * "/rocket" in the game, they'll get launched into the air!
   */
  world.chatManager.registerCommand('/rocket', player => {
    world.entityManager.getPlayerEntitiesByPlayer(player).forEach(entity => {
      entity.applyImpulse({ x: 0, y: 20, z: 0 });
    });
  });

  /**
   * Play some peaceful ambient music to
   * set the mood!
   */
  
  new Audio({
    uri: 'audio/music/hytopia-main-theme.mp3',
    loop: true,
    volume: 0.1,
  }).play(world);
});
