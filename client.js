const iceConnectionLog = document.getElementById('ice-connection-state'),
      iceGatheringLog = document.getElementById('ice-gathering-state'),
      signalingLog = document.getElementById('signaling-state'),
      dataChannelLog = document.getElementById('data-channel'),
      audioLog = document.getElementById('audio-log');

const clientId = randomId(10);
const websocket = new WebSocket('ws://127.0.0.1:8000/' + clientId);

let pc = null;
let dc = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingStartTime = null;
let audioStream = null;

websocket.onopen =
    () => {
        document.getElementById('start').disabled = false;
        audioLog.textContent += 'WebSocket connected\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    }

          websocket.onclose =
        () => {
            audioLog.textContent += 'WebSocket disconnected\n';
            audioLog.scrollTop = audioLog.scrollHeight;
        }

              websocket.onerror =
            (error) => {
                audioLog.textContent += 'WebSocket error: ' + error + '\n';
                audioLog.scrollTop = audioLog.scrollHeight;
            }

                       websocket.onmessage =
                async (evt) => {
                if (typeof evt.data !== 'string')
                {
                    return;
                }
                const message = JSON.parse(evt.data);
                if (message.type == "offer")
                {
                    document.getElementById('offer-sdp').textContent = message.sdp;
                    await handleOffer(message)
                }
            }

function createPeerConnection() {
    const config = {
        bundlePolicy : "max-bundle",
    };

    if (document.getElementById('use-stun').checked)
    {
        config.iceServers = [ {urls : [ 'stun:stun.l.google.com:19302' ]} ];
    }

    let pc = new RTCPeerConnection(config);

    // Register some listeners to help debugging
    pc.addEventListener('iceconnectionstatechange', () => {
        iceConnectionLog.textContent += ' -> ' + pc.iceConnectionState;
        audioLog.textContent += 'ICE Connection: ' + pc.iceConnectionState + '\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    });
    iceConnectionLog.textContent = pc.iceConnectionState;

    pc.addEventListener('icegatheringstatechange', () => {
        iceGatheringLog.textContent += ' -> ' + pc.iceGatheringState;
        audioLog.textContent += 'ICE Gathering: ' + pc.iceGatheringState + '\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    });
    iceGatheringLog.textContent = pc.iceGatheringState;

    pc.addEventListener('signalingstatechange', () => {
        signalingLog.textContent += ' -> ' + pc.signalingState;
        audioLog.textContent += 'Signaling: ' + pc.signalingState + '\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    });
    signalingLog.textContent = pc.signalingState;

    // Receive audio/video track
    pc.ontrack = (evt) => {
        audioLog.textContent += 'Received media track: ' + evt.track.kind + '\n';
        audioLog.scrollTop = audioLog.scrollHeight;

        document.getElementById('media').style.display = 'block';
        const stream = evt.streams[0];

        // Handle audio - this is our main focus
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
            audioLog.textContent += 'Audio track detected: ' + audioTracks[0].label + '\n';
            audioLog.scrollTop = audioLog.scrollHeight;

            // Create audio-only stream for recording
            audioStream = new MediaStream([audioTracks[0]]);

            // Set up audio element for playback
            const audio = document.getElementById('audio');
            audio.srcObject = audioStream;
            audio.muted = true; // Mute to avoid feedback
            audio.play()
                .then(() => {
                    audioLog.textContent += 'Audio playback started\n';
                    audioLog.scrollTop = audioLog.scrollHeight;
                })
                .catch(err => {
                    audioLog.textContent += 'Audio playback failed: ' + err + '\n';
                    audioLog.scrollTop = audioLog.scrollHeight;
                });

            // Enable the start recording button instead of auto-starting
            document.getElementById('start-recording').disabled = false;
            audioLog.textContent += 'Audio ready - you can now start recording\n';
            audioLog.scrollTop = audioLog.scrollHeight;
        }
    };

    // Receive data channel
    pc.ondatachannel =
        (evt) => {
            dc = evt.channel;

            dc.onopen = () => {
                dataChannelLog.textContent += '- open\n';
                dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
                audioLog.textContent += 'Data channel opened\n';
                audioLog.scrollTop = audioLog.scrollHeight;
            };

            let dcTimeout = null;
            dc.onmessage =
                (evt) => {
                    if (typeof evt.data !== 'string')
                    {
                        return;
                    }

                    dataChannelLog.textContent += '< ' + evt.data + '\n';
                    dataChannelLog.scrollTop = dataChannelLog.scrollHeight;

                    dcTimeout = setTimeout(() => {
                        if (!dc)
                        {
                            return;
                        }
                        const message = `Pong ${currentTimestamp()}`;
                        dataChannelLog.textContent += '> ' + message + '\n';
                        dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
                        dc.send(message);
                    }, 1000);
                }

                         dc.onclose = () => {
                    clearTimeout(dcTimeout);
                    dcTimeout = null;
                    dataChannelLog.textContent += '- close\n';
                    dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
                    audioLog.textContent += 'Data channel closed\n';
                    audioLog.scrollTop = audioLog.scrollHeight;
                };
        }

    return pc;
}

function startRecordingManually() {
    if (audioStream) {
        startAudioRecording(audioStream);
        document.getElementById('start-recording').disabled = true;
    }
}

function startAudioRecording(stream) {
    if (isRecording)
    {
        stopAudioRecording();
    }

    recordedChunks = [];

    try
    {
        // Prioritize WebM/Opus for best audio quality in real-time streaming
        let options = {};
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        {
            options = {mimeType : 'audio/webm;codecs=opus'};
        }
        else if (MediaRecorder.isTypeSupported('audio/webm'))
        {
            options = {mimeType : 'audio/webm'};
        }
        else if (MediaRecorder.isTypeSupported('audio/mp4'))
        {
            options = {mimeType : 'audio/mp4'};
            audioLog.textContent +=
                'Warning: Using MP4 - may have quality issues for real-time audio\n';
            audioLog.scrollTop = audioLog.scrollHeight;
        }
        else
        {
            options = {}; // Use default
        }

        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0)
            {
                recordedChunks.push(event.data);
                audioLog.textContent += 'Audio chunk recorded: ' + event.data.size + ' bytes\n';
                audioLog.scrollTop = audioLog.scrollHeight;
            }
        };

        mediaRecorder.onstop = () => {
            const recordingDuration =
                recordingStartTime ? (Date.now() - recordingStartTime) / 1000 : 0;
            audioLog.textContent += 'Recording stopped after ' + recordingDuration.toFixed(2) +
                                    's, processing ' + recordedChunks.length + ' chunks\n';
            audioLog.scrollTop = audioLog.scrollHeight;

            if (recordedChunks.length > 0)
            {
                const blob =
                    new Blob(recordedChunks, {type : mediaRecorder.mimeType || 'audio/webm'});
                const url = URL.createObjectURL(blob);

                // Enable download button
                const downloadBtn = document.getElementById('download-audio');
                downloadBtn.disabled = false;
                downloadBtn.onclick = () => downloadAudio(url, blob, recordingDuration);

                audioLog.textContent += 'Audio ready for download (' + blob.size + ' bytes, ~' +
                                        recordingDuration.toFixed(2) + 's)\n';
                audioLog.scrollTop = audioLog.scrollHeight;
            }
        };

        mediaRecorder.onerror = (event) => {
            audioLog.textContent += 'Recording error: ' + event.error + '\n';
            audioLog.scrollTop = audioLog.scrollHeight;
        };

        mediaRecorder.start(100); // Collect data every 100ms
        isRecording = true;
        recordingStartTime = Date.now();

        document.getElementById('stop-recording').disabled = false;

        audioLog.textContent +=
            'Audio recording started (MIME: ' + (mediaRecorder.mimeType || 'default') + ')\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    }
    catch (error)
    {
        audioLog.textContent += 'Failed to start recording: ' + error + '\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    }
}

function stopAudioRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive')
    {
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById('stop-recording').disabled = true;
        // Re-enable start recording if audio stream is still available
        if (audioStream) {
            document.getElementById('start-recording').disabled = false;
        }
        audioLog.textContent += 'Stopping audio recording...\n';
        audioLog.scrollTop = audioLog.scrollHeight;
    }
}

async function downloadAudio(url, blob, duration) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension =
        blob.type.includes('webm') ? 'webm' : (blob.type.includes('mp4') ? 'mp4' : 'audio');

    // Try to get more accurate duration from audio data for WebM files
    let actualDuration = duration;
    if (blob.type.includes('webm') && blob.size > 0)
    {
        try
        {
            const audioDuration = await getAudioDurationFromBlob(blob);
            if (audioDuration && audioDuration > 0)
            {
                actualDuration = audioDuration;
                audioLog.textContent +=
                    'Calculated audio duration: ' + actualDuration.toFixed(2) + 's\n';
                audioLog.scrollTop = audioLog.scrollHeight;
            }
        }
        catch (err)
        {
            audioLog.textContent += 'Could not calculate audio duration: ' + err.message + '\n';
            audioLog.scrollTop = audioLog.scrollHeight;
        }
    }

    const durationStr = actualDuration ? `_${actualDuration.toFixed(0)}s` : '';
    const filename = `received_audio_${timestamp}${durationStr}.${extension}`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    audioLog.textContent += 'Downloaded: ' + filename + ' (Format: ' + blob.type;
    if (actualDuration)
    {
        audioLog.textContent += ', Duration: ' + actualDuration.toFixed(2) + 's';
    }
    audioLog.textContent += ')\n';
    audioLog.scrollTop = audioLog.scrollHeight;
}

// Helper function to get audio duration from blob using Web Audio API
async function getAudioDurationFromBlob(blob) {
    return new Promise((resolve, reject) => {
        try
        {
            const audio = new Audio();
            const url = URL.createObjectURL(blob);

            audio.onloadedmetadata = () => {
                URL.revokeObjectURL(url);
                if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration))
                {
                    resolve(audio.duration);
                }
                else
                {
                    // If HTML5 audio can't get duration, resolve with null
                    resolve(null);
                }
            };

            audio.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null); // Don't reject, just return null
            };

            audio.onabort = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };

            // Set timeout to avoid hanging
            setTimeout(() => {
                URL.revokeObjectURL(url);
                resolve(null);
            }, 2000);

            audio.src = url;
        }
        catch (err)
        {
            resolve(null);
        }
    });
}

async function waitGatheringComplete() {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete')
        {
            resolve();
        }
        else
        {
            pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete')
                {
                    resolve();
                }
            });
        }
    });
}

async function sendAnswer(pc) {
    await pc.setLocalDescription(await pc.createAnswer());
    await waitGatheringComplete();

    const answer = pc.localDescription;
    document.getElementById('answer-sdp').textContent = answer.sdp;

    websocket.send(JSON.stringify({
        id : "server", // Target the streamer (which uses ID "server")
        type : answer.type,
        sdp : answer.sdp,
    }));

    audioLog.textContent += 'Sent answer to server\n';
    audioLog.scrollTop = audioLog.scrollHeight;
}

async function handleOffer(offer) {
    pc = createPeerConnection();
    await pc.setRemoteDescription(offer);
    await sendAnswer(pc);
    audioLog.textContent += 'Handled offer from server\n';
    audioLog.scrollTop = audioLog.scrollHeight;
}

function sendRequest() {
    websocket.send(JSON.stringify({
        id : "server", // Target the streamer (which uses ID "server")
        type : "request",
    }));
    audioLog.textContent += 'Sent connection request to server\n';
    audioLog.scrollTop = audioLog.scrollHeight;
}

function start() {
    document.getElementById('start').style.display = 'none';
    document.getElementById('stop').style.display = 'inline-block';
    document.getElementById('media').style.display = 'block';
    sendRequest();
}

function stop() {
    document.getElementById('stop').style.display = 'none';
    document.getElementById('media').style.display = 'none';
    document.getElementById('start').style.display = 'inline-block';

    // Stop audio recording
    stopAudioRecording();

    // Reset recording buttons
    document.getElementById('start-recording').disabled = true;
    document.getElementById('stop-recording').disabled = true;
    document.getElementById('download-audio').disabled = true;
    
    // Clear audio stream reference
    audioStream = null;

    // close data channel
    if (dc)
    {
        dc.close();
        dc = null;
    }

    // close transceivers
    if (pc && pc.getTransceivers)
    {
        pc.getTransceivers().forEach((transceiver) => {
            if (transceiver.stop)
            {
                transceiver.stop();
            }
        });
    }

    // close local audio/video
    if (pc)
    {
        pc.getSenders().forEach((sender) => {
            const track = sender.track;
            if (track !== null)
            {
                sender.track.stop();
            }
        });

        // close peer connection
        pc.close();
        pc = null;
    }

    audioLog.textContent += 'Connection stopped\n';
    audioLog.scrollTop = audioLog.scrollHeight;
}

// Helper function to generate a random ID
function randomId(length) {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const pickRandom = () => characters.charAt(Math.floor(Math.random() * characters.length));
    return [...Array(length) ].map(pickRandom).join('');
}

// Helper function to generate a timestamp
let startTime = null;

function currentTimestamp()
{
    if (startTime === null)
    {
        startTime = Date.now();
        return 0;
    }
    else
    {
        return Date.now() - startTime;
    }
}

// Clear logs
function clearLogs()
{
    audioLog.textContent = '';
    dataChannelLog.textContent = '';
    iceConnectionLog.textContent = '';
    iceGatheringLog.textContent = '';
    signalingLog.textContent = '';
    document.getElementById('offer-sdp').textContent = '';
    document.getElementById('answer-sdp').textContent = '';
}
