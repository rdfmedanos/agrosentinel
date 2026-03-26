import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://192.168.100.20:1883', {
  username: 'admin@agrosentinel.com',
  password: 'Empresa123!'
});

client.on('connect', () => {
  client.subscribe('devices/ESP8266_cb24b3/telemetry');
  console.log('Listening for telemetry on ESP8266_cb24b3...');
});

client.on('message', (topic, message) => {
  console.log(`Received message on ${topic}: ${message.toString()}`);
  client.end();
});
