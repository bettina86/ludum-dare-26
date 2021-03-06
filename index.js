var Detector = require('./detector')
var websocket = require('websocket-stream')
var duplexEmitter = require('duplex-emitter')
var skin = require('minecraft-skin')
var _ = require('underscore')
var highlight = require('voxel-highlight')
var createGame = require('voxel-hello-world')
var voxelMesh = require('voxel-mesh')
var voxel = require('voxel')
var createVirus = require('voxel-virus')
var toWater = require('voxel-virus/example/water')
var gameMessages = document.querySelector('#game-messages')

var lerpPercent = 0.2
var updateRate = 50
var updateBufferSize = 5
var buildPhaseTime = 180000
var b = [[-50, -32], [50, 32]]
var height = 5
var dimensions = [b[0][1] - b[0][0], b[1][1] - b[1][0]]

boot()

function boot() {
  
  if( !Detector().webgl ) { return alert('you are not webgl capable!')  }

  var id = ~~(Math.random() * 10000) + '' + ~~(Math.random() * 10000)
  var peer = new Peer(id, {host: 'peerjs-maxogden.jit.su', port: 80})
  // var peer = new Peer(id, {host: 'pizzacats.local', port: 9000})
  var socket = websocket('ws://p2plobby.jit.su')
  // var socket = websocket('ws://pizzacats.local:8080')
  window.peer = peer
  window.socket = socket
  var emitter = duplexEmitter(socket)

  createGame({
    texturePath: './textures/',
    materials: ['blue', 'red', 'water', 'yellow', 'green'],
    chunkDistance: 4,
    materialParams: { vertexColors: 2 },
    fogDisabled: true,
    generate: function(x, y, z) {
      if (b[0][0] < x && x < b[1][0] && b[0][1] < z && z < b[1][1] && y === 0) return 1
      if (x === b[1][0] && z >= b[0][1] && z < b[1][1] && y >= 0 && y <= height) return 1
      if (x === b[0][0] && z >= b[0][1] && z < b[1][1] && y >= 0 && y <= height) return 1
      if (z === b[1][1] && x >= b[0][0] && x < b[1][0] && y >= 0 && y <= height) return 1
      if (z === b[0][1] && x >= b[0][0] && x < b[1][0] && y >= 0 && y <= height) return 1
      return 0
    }
  }, setup)

  function setup(game, avatar) {
    window.game = game
    
    peer.on('connection', function(conn) {
      var messages = document.querySelector('.messages')
      messages.innerHTML += 'connected! prepare to play<br>'
      setTimeout(hideWelcome, 2000)
      emitter.emit('connected')
      socket.ws.close()
      game.paused = false
      setTimeout(startWater, buildPhaseTime)
      avatar.position.copy({x: 45, y: 5, z: -5})
      avatar.rotation.y = 1.6100000000000003
      transmitStateStream(game, conn)
      conn.on('data', updateOpponent)
      conn.on('error', resetGame)
      conn.on('close', resetGame)
    })
    
    peer.on('error', resetGame)
    peer.on('close', resetGame)

    var editBuffer = []
    function updateBuffer(op) {
      editBuffer.unshift(op)
      if (editBuffer.length >= updateBufferSize) editBuffer = editBuffer.slice(0, 5)
      if (window.conn) {
        var msg = [
          'e'
        ]
        editBuffer.map(function(edit) {
          msg.push(edit.join(':'))
        })
        msg = msg.join('|')
        conn.send(msg)
      }
    }
    
    addLights(game)
    
    var blueVirus = createVirus({
      game: game,
      material: 3,
    })
    var toVirus = toWater(blueVirus, 3)

    game.on('tick', blueVirus.tick.bind(blueVirus))

    var greenVirus = createVirus({
      game: game,
      material: 5,
    })
    var toVirus = toWater(greenVirus, 5)

    game.blueVirus = blueVirus
    game.greenVirus = greenVirus

    game.on('tick', greenVirus.tick.bind(greenVirus))

    var start1 = [-40, 30, 0]
    var start2 = [40, 30, 0]

    game.setBlock(start1, 'yellow')
    game.setBlock(start2, 'yellow')

    game.setBlock([start1[0], start1[1] - 5, start1[2]], 'red')
    game.setBlock([start2[0], start2[1] - 5, start2[2]], 'red')

    function startWater() {
      blueVirus.infect([start1[0], start1[1] - 1, start1[2]])
      greenVirus.infect([start2[0], start2[1] - 1, start2[2]])
      setTimeout(countVoxels, 20000)
    }
    
    function countVoxels() {
      var bounds = b
      var l = bounds[0], h = bounds[1]
      var green = 0, blue = 0
      for(var z = l[1]; z <= h[1]; ++z) {
        for(var y = 0; y <= 30; ++y) {
          for(var x = l[0]; x <= h[0]; ++x) {
            var val = game.getBlock(x,y,z)
            if (val === 3) blue++
            if (val === 5) green++
          }
        }
      }
      gameMessages.innerHTML = "Results: Green blocks: " + green + ", Blue blocks: " + blue + ". Thanks for playing!"
    }
    
    window.countVoxels = countVoxels
    
    var gtarget = game.controls.target()
    gtarget.avatar.cameraInside.position.y = 25
    gtarget.avatar.cameraInside.position.z = 3
    gtarget.playerSkin.playerModel.position.y += 2
    
    avatar.position.copy({x: 2, y: 6, z: 4})
    game.voxels.removeAllListeners('missingChunk')

    var blockPosPlace, blockPosErase
    var hl = game.highlighter = highlight(game, { color: 0xFF0000, distance: 100, wireframeLinewidth: 5 })
    hl.on('highlight', function (voxelPos) { blockPosErase = voxelPos })
    hl.on('remove', function (voxelPos) { blockPosErase = null })
    hl.on('highlight-adjacent', function (voxelPos) { blockPosPlace = voxelPos })
    hl.on('remove-adjacent', function (voxelPos) { blockPosPlace = null })
    
    game.on('fire', function (target, state) {
      var select = game.controls.state.select
      var position = blockPosPlace
      if (state.firealt) {
        var vec = game.cameraVector();
        var pos = game.cameraPosition();
        var placeLoc = game.raycast(pos, vec, 100).adjacent
        game.createBlock(placeLoc, 'red')
        updateBuffer(placeLoc, 2)
      } else if (position) {
        game.createBlock(position, 'red')
        checkAround(position)
        updateBuffer([position[0], position[1], position[2], 2])
      } else {
        position = blockPosErase
        var val = game.getBlock(position)
        if (position && val !== 4 && val !== 1) {
          game.setBlock(position, 0)
          checkAround(position)
          updateBuffer([position[0], position[1], position[2], 0])
        }
      }
    })
    
    // document.addEventListener('mousedown')

    document.querySelector('.instructions').innerHTML = document.querySelector('#loaded').innerHTML
    document.querySelector('.look').addEventListener('click', function(e) {
      document.querySelector('.look').style.display = 'none'
      var messages = document.querySelector('.messages')
      messages.innerHTML += 'waiting for opponent...<br>'
      emitter.emit('looking', id)
      emitter.on('nobody', function() {
        messages.innerHTML += 'you are the only one waiting...<br>'
      })
      emitter.on('peer', function(peerID) {
        messages.innerHTML += 'opponent found. trying to connect...<br>'
        var conn = peer.connect(peerID)
        conn.on('open', function() {
          messages.innerHTML += 'connected! prepare to play<br>'
          setTimeout(hideWelcome, 2000)
          socket.ws.close()
          setTimeout(startWater, buildPhaseTime)
          avatar.position.copy({x: -45, y: 5, z: -5})
          avatar.rotation.y = -1.6360000000000001
          emitter.emit('connected')
          transmitStateStream(game, conn)
          conn.on('data', updateOpponent)
        })
        conn.on('error', resetGame)
        conn.on('close', resetGame)
      })
    })
  }
}

function checkAround(position) {
  var around = [
    [0, 1, 0], [0, -1, 0],
    [1, 0, 0], [-1, 0, 0],
    [0, 0, 1], [0, 0, -1],
  ]
  around.forEach(function(p) {
    var nextTo = [position[0] + p[0], position[1] + p[1], position[2] + p[2]]
    var val = game.getBlock(nextTo)
    if (val === 3) {
      setTimeout(function() {
        game.blueVirus.infect(nextTo)
      }, 1000)
    }
    if (val === 5) {
      setTimeout(function() {
        game.greenVirus.infect(nextTo)
      }, 1000)
    }
  })
}

function updateOpponent(message) {
  if (!window.game) return
  if (!window.opponent) createOpponent(window.game)
  if (message[0] === 'p') {
    var parts = message.split('|')
    var update = {
      position: {x: +parts[1], y: +parts[2], z: +parts[3]},
      rotation: {x: +parts[4], y: +parts[5]}
    }
    opponent.mesh.position.copy(opponent.mesh.position.lerp(update.position, lerpPercent))
    opponent.mesh.children[0].rotation.y = update.rotation.y + (Math.PI / 2)
    opponent.head.rotation.z = scale(update.rotation.x, -1.5, 1.5, -0.75, 0.75)
  } else if (message[0] === 'e') {
    message.split('|').map(function(edit) {
      if (edit === 'e') return
      edit = edit.split(':')
      var val = +edit[3]
      var setpos = [+edit[0], +edit[1], +edit[2]]
      game.setBlock(setpos, val)
      if (val === 0 || val === 2) checkAround(setpos)
    })
  } else {
    console.log('unknown type', message)
  }
}

function createOpponent(game) {
  var playerSkin = skin(game.THREE, 'player.png', {
    scale: new this.game.THREE.Vector3(0.08, 0.08, 0.08)
  })
  var playerMesh = playerSkin.mesh
  window.opponent = playerSkin
  playerSkin.playerModel.position.y += 2
  playerMesh.children[0].position.y = 10
  game.scene.add(playerMesh)
}

function transmitStateStream(game, conn) {
  window.conn = conn
  game.controls.on('data', _.throttle(function(state) {
    var interacting = false
    Object.keys(state).map(function(control) {
      if (state[control] > 0) interacting = true
    })
    if (interacting) sendState(game, conn)
  }, updateRate))
}

function sendState(game, conn) {
  var player = game.controls.target()
  var state = [
    'p',
    player.position.x.toFixed(4),
    player.position.y.toFixed(4),
    player.position.z.toFixed(4),
    player.pitch.rotation.x.toFixed(4),
    player.yaw.rotation.y.toFixed(4)
  ].join('|')
  conn.send(state)
}

function hideWelcome() {
  var doneTime = Date.now() + buildPhaseTime
  var countdown = setInterval(function() {
    if (doneTime < Date.now()) return clearInterval(countdown)
    gameMessages.innerHTML = ~~((doneTime - Date.now()) / 1000) + " seconds remaining until water starts flowing from the yellow blocks!"
  }, 1000)
  document.querySelector('#welcome').style.display = 'none'
}

function addLights(game) {
  var gg = new game.THREE.PlaneGeometry( 16000, 16000 )
  var gm = new game.THREE.MeshBasicMaterial( { color: 0xdff2fc } )

  var ground = new game.THREE.Mesh( gg, gm )
  window.ground = ground
  ground.rotation.x = - Math.PI / 2
  ground.receiveShadow = true

  game.scene.add( ground )
  game.view.renderer.setClearColor( 0xffffff, 1 )
}

function addMarker(game, position) {
  var geometry = new game.THREE.SphereGeometry( 1, 4, 4 )
  var material = new game.THREE.MeshPhongMaterial( { color: 0xffffff, shading: game.THREE.FlatShading } )
  var mesh = new game.THREE.Mesh( geometry, material )
  mesh.position.copy(position)
  game.scene.add(mesh)
}

function scale( x, fromLow, fromHigh, toLow, toHigh ) {
  return ( x - fromLow ) * ( toHigh - toLow ) / ( fromHigh - fromLow ) + toLow
}

function resetGame() {
  alert('other player left, refresh page to find a new opponent')
}

(function () {
  var blockContextMenu = function (evt) {
    evt.preventDefault();
  };

  window.addEventListener('contextmenu', blockContextMenu);
})()