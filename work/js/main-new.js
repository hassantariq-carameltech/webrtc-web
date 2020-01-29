'use strict';

var isInitiator = false;
var isChannelReady = false;
var localStream;
var peerConnections = {};
let clientId;
const servers = null;
var answered = {};

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
const offerOptions = {
  offerToReceiveAudio: false,
  offerToReceiveVideo: true
};

var localVideo = document.querySelector('#localVideo');
var remoteVideos = document.querySelector('#remoteVideos');

var socket = io.connect();

if (room !== "") {
  console.log('Message from client: Asking to join room: ' + room);
  socket.emit('create or join', room);
}

socket.on('created', function(room, _clientId) {
  console.log("'on.created' -->> 'shouldInitiate own stream' in room: ", room, _clientId);
  clientId = _clientId;
  initiateStream();
});

socket.on('other.joined', function (room, _clientId) {
  console.log(`'on.other.joined' <<-- room: 'remoteStream' should receive here, from client: ${_clientId}`);
  // isChannelReady = true;
});

socket.on('joined', function(room, _clientId) {
  console.log("'on.joined' -->> 'shouldInitiate own stream' usecase, in room: ", room, _clientId);
  isInitiator = false;
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
  console.log("LocalStream' Available locally, let all know that I have the stream");
  window.localStream = stream;
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
  console.log("sendMesage: ", message);
  socket.emit('message', message);
}

socket.on('message', function(message) {
  // console.log(`  'on.message'=> type: ${message.payload.type}, by client: ${message.clientId}`, message);
  switch(message.payload.type) {
    case GOT_USER_MEDIA: 
      console.log("  stream available from client: ", message.clientId, ", lets send an offer");

      // Create local peer connection
      console.log(`  1. create RTCPeerConnection`);
      let localConnection = new RTCPeerConnection(servers);

      // Handlers
      localConnection.onicecandidate = handleIceCandidate(message.clientId);
      console.log(`  2. addTracks in connection`);
      localConnection.ontrack = handleTrack(message.clientId);
      
      
      //Store in global Hash
      peerConnections[message.clientId] = {
        connection: localConnection,
        trackAdded: false
      };

      // Broadcast tracks to all existing connections
      window.localStream.getTracks().forEach(track => {
        Object.keys(peerConnections).forEach((id) => {
          if (!peerConnections[id].trackAdded) {
            peerConnections[id].connection.addTrack(track, window.localStream);
            peerConnections[id].trackAdded = true;
          }
        });
      });
      
      // Send Offer
      console.log(`  3. create Offer`);
      localConnection.createOffer(offerOptions)
      .then(
        (desc) => {
          // Set Local Description
          console.log(`  4. setLocalDescription`);
          localConnection.setLocalDescription(desc);
          console.log(`  5. sendMessage regarding 'offer'`);
          sendMessage(desc);
        }, 
        (error) => {
          console.error('  Failed to create session description: ' + error.toString());
        });
        
      break;
    case OFFER: 
      console.log("  stream offer received from", message.clientId);
      if (peerConnections[message.clientId]) return console.error(`  * connection already exists in session with ${message.clientId}`);
      
      // Create remote peer connection 
      console.log(`  6. create RTCPeerConnection`);
      let remoteConnection = new RTCPeerConnection(servers);
      
      // Handlers
      remoteConnection.onicecandidate = handleIceCandidate(message.clientId);
      remoteConnection.ontrack = handleTrack(message.clientId);

      //Store in global Hash
      peerConnections[message.clientId] = {
        connection: remoteConnection,
        trackAdded: false
      };

      // Broadcast tracks to all existing connections
      window.localStream.getTracks().forEach(track => {
        Object.keys(peerConnections).forEach((id) => {
          if (!peerConnections[id].trackAdded) {
            peerConnections[id].connection.addTrack(track, window.localStream);
            peerConnections[id].trackAdded = true;
          }
        });
      });

      // Set Remote Description
      console.log(`  7. setRemoteDescription`);
      remoteConnection.setRemoteDescription(new RTCSessionDescription(message.payload));

      // Send Answer
      console.log(`  8. createAnswer`);
      remoteConnection.createAnswer()
        .then(
          (desc) => {
            // Set Local Description
            console.log(`  9. setLocalDescription`);
            remoteConnection.setLocalDescription(desc);
            console.log(`  10. sendMessage regarding 'answer'`);
            sendMessage(desc);
      },
      (error) => {
        console.error('  Failed to create session description: ' + error.toString());
      });


      // maybeStart(message.clientId);
      // answerTheOffer(message.clientId, message.payload);
      break;
    case ANSWER: 
      console.log(" received answer from ", message.clientId);
      if (!answered[message.clientId]) {
        console.log(`  11. setRemoteDescription`);
        peerConnections[message.clientId].connection.setRemoteDescription(new RTCSessionDescription(message.payload));
        answered[message.clientId] = true;
      }
      break;
    case CANDIDATE:
      console.log("  candidate ", message, peerConnections);
      if (peerConnections[message.clientId] && peerConnections[message.clientId].connection) {
        var candidate = new RTCIceCandidate({
          sdpMLineIndex: message.payload.label,
          candidate: message.payload.candidate
        });
        peerConnections[message.clientId].connection.addIceCandidate(candidate);
      }
      break;
    
  }

});

function handleTrack(forClientId) {
  return (event) => {
    console.log('  handleTrack for :', forClientId, "event: ", event);
    let element = document.createElement('video');
    element.setAttribute('autoplay', '');
    element.srcObject = event.streams[0];
    remoteVideos.appendChild(element);
  };
}

function handleIceCandidate(forClientId) {
  return (event) => {
    // console.log(`handleIceCandidate for clientId: ${forClientId}, event: `, event);
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