'use strict';

var isInitiator = false;
var isChannelReady = false;
var localStream;
var peerConnections = {};
let clientId;

const GOT_USER_MEDIA = 'got user media',
      OFFER = 'offer',
      ANSWER = 'answer',
      CANDIDATE = 'candidate',
      BYE = 'bye';

// window.room = prompt("Enter room name:");
window.room = 'foo';

var pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

var localVideo = document.querySelector('#localVideo');
var remoteVideos = document.querySelector('#remoteVideos');



var socket = io.connect();

if (room !== "") {
  console.log('Message from client: Asking to join room ' + room);
  socket.emit('create or join', room);
}

socket.on('created', function(room, _clientId) {
  console.log("'on.created'", room, _clientId);
  clientId = _clientId;
  isInitiator = true;
  initiateStream();
});

socket.on('join', function (room, _clientId){
  console.log(`'on.join' room: ${room}, from client: ${_clientId}`);
  isChannelReady = true;
});

socket.on('joined', function(room, _clientId) {
  console.log("'on.joined'", room, _clientId);
  isInitiator = false;
  isChannelReady = true;
  clientId = _clientId;
  initiateStream();
});

socket.on('full', function(room) {
  console.log('Message from client: Room ' + room + ' is full :^(');
});

socket.on('ipaddr', function(ipaddr) {
  console.log('Message from client: Server IP address is ' + ipaddr);
});

socket.on('log', function(array) {
  console.log.apply(console, array);
});

function initiateStream() {
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true
  })
  .then(gotStream)
  .catch(function(e) {
    console.error('getUserMedia() error: ' + e.name);
  });
}

function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage({
    type: GOT_USER_MEDIA
  });
}

function sendMessage(payload) {
  var message = {
    clientId: clientId,
    payload: payload
  };
  console.log("--> sending message", message);
  socket.emit('message', message);
}

socket.on('message', function(message) {
  console.log(`  'on.message'=> type: ${message.payload.type}, by client: ${message.clientId}`, message);
  switch(message.payload.type) {
    case GOT_USER_MEDIA: 
      console.log("  time to start streaming between ", clientId, message.clientId);
      maybeStart(message.clientId);
      sendOffer(message.clientId);
      break;
    case OFFER: 
      console.log("  received offer from", message.clientId);
      maybeStart(message.clientId);
      answerTheOffer(message.clientId, message.payload);
      break;
    case ANSWER: 
      console.log(" received answer from ", message.clientId);
      peerConnections[message.clientId].setRemoteDescription(new RTCSessionDescription(message.payload));
      break;
    case CANDIDATE:
      console.log("  candidate ", message, peerConnections);
      if (peerConnections[message.clientId]) {
        var candidate = new RTCIceCandidate({
          sdpMLineIndex: message.payload.label,
          candidate: message.payload.candidate
        });
        peerConnections[message.clientId].addIceCandidate(candidate);
      }
      break;
    
  }

});

function answerTheOffer(forClientId, payload) {
  peerConnections[forClientId].setRemoteDescription(new RTCSessionDescription(payload));
  peerConnections[forClientId].createAnswer().then((sessionDesc) => {
    console.log(`  answer created for ${forClientId}`);
    setLocalAndSendMessage(forClientId, sessionDesc);
  }, (error) => {
    console.log('Failed to create session description: ' + error.toString());
  });
}

function createPeerConnection(forClientId) {
  try {
    let connection = new RTCPeerConnection(null);
    connection.onicecandidate = handleIceCandidate(forClientId);
    connection.onaddstream = handleRemoteStreamAdded(forClientId);
    connection.onremovestream = handleRemoteStreamRemoved(forClientId);
    peerConnections[forClientId] = connection;
    console.log('  Created RTCPeerConnnection for ', forClientId);
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function maybeStart(forClientId) {
  if (typeof localStream !== 'undefined' && !peerConnections[forClientId] ) {
    createPeerConnection(forClientId);
    addStream(forClientId);
  }
}

function addStream(forClientId) {
  peerConnections[forClientId].addStream(localStream);
  console.log("  added Stream for ", forClientId);
  // localStream.getTracks((track) => {
  //   peerConnections[forClientId].addTrack(track, localStream);
  //   console.log("  added Stream for ", forClientId, track);
  // })
}

function sendOffer(forClientId) {
  peerConnections[forClientId].createOffer((sessionDesc) => {
    console.log(`  offer created for ${forClientId}`);
    setLocalAndSendMessage(forClientId, sessionDesc)
  }, (error) => {
    console.error('  Failed to create session description: ' + error.toString());
  });
}

function setLocalAndSendMessage(forClientId, sessionDesc) {
  peerConnections[forClientId].setLocalDescription(sessionDesc);
  console.log(`  local description has been set for clientId: ${forClientId}`);
  sendMessage(sessionDesc);
}


function handleIceCandidate(forClientId) {
  return (event) => {
    console.log(`handleIceCandidate for clientId: ${forClientId}, event: `, event);
    if (event.candidate) {
      sendMessage({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex, 
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate
      });
    } else {
      console.log('End of candidates.');
    }
  }
}

function handleRemoteStreamAdded(forClientId) {
  return (event) => {
    console.log('  handleRemoteStreamAdded for :', forClientId, "event: ", event);
    let element = document.createElement('video');
    element.setAttribute('autoplay', '');
    element.srcObject = event.stream;
    remoteVideos.appendChild(element);
  }
}

function handleRemoteStreamRemoved(forClientId) {
  return (event) => {
    console.log('  handleRemoteStreamRemoved for :', forClientId, "event: ", event);
  }
}