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
  // Find all checkpoint blocks (orange concrete, ID 5) from the map
  const ORANGE_CONCRETE_BLOCK_ID = 5;
  const checkpointBlocks: Vector3Like[] = [];
  
  // Parse map to find all orange concrete blocks
  const blocks = worldMap.blocks;
  for (const [coord, blockId] of Object.entries(blocks)) {
    if (blockId === ORANGE_CONCRETE_BLOCK_ID) {
      const [x, y, z] = coord.split(',').map(Number);
      checkpointBlocks.push({ x, y: y + 1, z }); // y + 1 to place player on top of block
    }
  }
  
  // Sort checkpoints by progression (order by z-coordinate, then x-coordinate)
  // This determines the sequence of checkpoints
  checkpointBlocks.sort((a, b) => {
    if (Math.abs(a.z - b.z) > 0.5) {
      return a.z - b.z; // Primary sort by z-coordinate
    }
    return a.x - b.x; // Secondary sort by x-coordinate
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
  
  // Helper function to find which checkpoint block a position is at (within threshold)
  const findCheckpointAtPosition = (position: Vector3Like, threshold: number = 1.5): number | null => {
    for (let i = 0; i < checkpointBlocks.length; i++) {
      const checkpoint = checkpointBlocks[i];
      const distance = Math.sqrt(
        Math.pow(checkpoint.x - position.x, 2) +
        Math.pow(checkpoint.y - position.y, 2) +
        Math.pow(checkpoint.z - position.z, 2)
      );
      
      if (distance < threshold) {
        return i;
      }
    }
    
    return null;
  };

  world.on(PlayerEvent.JOINED_WORLD, async ({ player }) => {
    const defaultSpawnPosition: Vector3Like = { x: 0, y: 10, z: 0 };
    
    // Load saved checkpoint position or use default spawn
    const playerData = await player.getPersistedData();
    let checkpointPosition: Vector3Like = defaultSpawnPosition;
    
    if (playerData && playerData.checkpointPosition) {
      const savedCheckpoint = playerData.checkpointPosition as Vector3Like;
      // Validate the saved checkpoint has valid coordinates
      if (typeof savedCheckpoint.x === 'number' && 
          typeof savedCheckpoint.y === 'number' && 
          typeof savedCheckpoint.z === 'number') {
        checkpointPosition = savedCheckpoint;
      }
    }
    
    // Find nearest checkpoint that isn't the starting checkpoint
    let nearestCheckpoint: Vector3Like | null = null;
    let minDistance = Infinity;
    
    for (const checkpoint of checkpointBlocks) {
      // Skip if this is the starting checkpoint (within 2 blocks)
      const distToSpawn = Math.sqrt(
        Math.pow(checkpoint.x - defaultSpawnPosition.x, 2) +
        Math.pow(checkpoint.z - defaultSpawnPosition.z, 2)
      );
      if (distToSpawn < 2) continue;
      
      // Calculate distance from spawn position to this checkpoint
      const distance = Math.sqrt(
        Math.pow(checkpoint.x - checkpointPosition.x, 2) +
        Math.pow(checkpoint.z - checkpointPosition.z, 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestCheckpoint = checkpoint;
      }
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
    const LAVA_BLOCK_ID = 4;

    // Store current checkpoint position (will be updated when new checkpoint is set)
    let currentCheckpointPosition: Vector3Like = checkpointPosition;
    
    // Determine which checkpoint the player is currently on based on their saved position
    let currentCheckpointIndex = findCheckpointIndex(checkpointPosition);
    
    // Ensure currentCheckpointIndex is valid (in case checkpoint was removed or changed)
    if (currentCheckpointIndex >= checkpointBlocks.length) {
      currentCheckpointIndex = Math.max(0, checkpointBlocks.length - 1);
    }

    // Helper function to respawn player at checkpoint
    const respawnAtCheckpoint = () => {
      // Find nearest checkpoint for rotation
      let nearestCheckpoint: Vector3Like | null = null;
      let minDistance = Infinity;
      
      for (const checkpoint of checkpointBlocks) {
        const distToSpawn = Math.sqrt(
          Math.pow(checkpoint.x - defaultSpawnPosition.x, 2) +
          Math.pow(checkpoint.z - defaultSpawnPosition.z, 2)
        );
        if (distToSpawn < 2) continue;
        
        const distance = Math.sqrt(
          Math.pow(checkpoint.x - currentCheckpointPosition.x, 2) +
          Math.pow(checkpoint.z - currentCheckpointPosition.z, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          nearestCheckpoint = checkpoint;
        }
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
        const touchedCheckpointIndex = findCheckpointAtPosition(playerPosition);
        
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
        } else if (isNextCheckpoint) {
          // Player is on the next checkpoint - allow saving to progress
          const newCheckpointPosition = checkpointBlocks[touchedCheckpointIndex];
          currentCheckpointPosition = newCheckpointPosition;
          currentCheckpointIndex = touchedCheckpointIndex;
          player.setPersistedData({ checkpointPosition: newCheckpointPosition });
          world.chatManager.sendPlayerMessage(player, 'Checkpoint saved!', '00FF00');
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
