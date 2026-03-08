// ex: sw=4

import http from './http.js';

const base_url = 'http://localhost:8081';

function getDictionary() {
    return http.get(base_url + '/dictionary.json')
        .then(function (result) {
            return result.data;
        });
}

var objectProvider = {
    get: function (identifier) {
        return getDictionary().then(function (dictionary) {
            if (identifier.key === 'spacecraft') {
                return {
                    identifier: identifier,
                    name: dictionary.name,
                    type: 'folder',
                    location: 'ROOT'
                };
            } else {
                var measurement = dictionary.measurements.filter(function (m) {
                    return m.key === identifier.key;
                })[0];
                return {
                    identifier: identifier,
                    name: measurement.name,
                    type: 'example.telemetry',
                    telemetry: {
                        values: measurement.values
                    },
                    location: 'example.taxonomy:spacecraft'
                };
            }
        });
    }
};

var compositionProvider = {
    appliesTo: function (domainObject) {
        return domainObject.identifier.namespace === 'example.taxonomy' &&
               domainObject.type === 'folder';
    },
    load: function (domainObject) {
        return getDictionary()
            .then(function (dictionary) {
                return dictionary.measurements.map(function (m) {
                    return {
                        namespace: 'example.taxonomy',
                        key: m.key
                    };
                });
            });
    }
};

function NuclearesClock(socket) {
    const listeners = new Set();
    let lastValue = 0;

    socket.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "telemetry") {
            lastValue = msg.timestamp;

            // notify listeners
            listeners.forEach(callback => callback(lastValue));
        }
    });

    return {
        key: "nucleares-clock",
        name: "Nucleares Simulation Clock",
        cssClass: "icon-clock",
        description: "Clock driven by Nucleares simulation time",

        on(event, callback) {
            if (event === "tick") {
                listeners.add(callback);
            }
        },

        off(event, callback) {
            if (event === "tick") {
                listeners.delete(callback);
            }
        },

        currentValue() {
            return lastValue;
        }
    };
}

function NuclearesRealtimeTelemetryProvider(socket) {
    var listeners = new Map();

    socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);

	for (const [key, callback] of listeners) {
	    callback({
		id: key,
		timestamp: data.timestamp,
		value: data.value[key]
	    });
	}
    });

    return {
	supportsSubscribe: function (domainObject) {
	    return domainObject.type === 'example.telemetry';
	},

	subscribe: function (domainObject, callback) {
	    listeners.set(domainObject.identifier.key, callback);
	    return function unsubscribe() {
		listeners.delete(domainObject.identifier.key);
	    };
	}
    };
}

/** @type {OpenMCTPlugin} */
export default function NuclearesPlugin() {
    return function install(openmct) {
        openmct.objects.addRoot({
            namespace: 'example.taxonomy',
            key: 'spacecraft'
        });

        openmct.objects.addProvider('example.taxonomy', objectProvider);

        openmct.composition.addProvider(compositionProvider);

        openmct.types.addType('example.telemetry', {
            name: 'Example Telemetry Point',
            description: 'Example telemetry point from our happy tutorial.',
            cssClass: 'icon-telemetry'
        });

	openmct.time.addTimeSystem({
	    key: 'nucleares-time',
	    name: 'Reactor Time',
	    timeFormat: 'nucleares-time-format',
	    durationFormat: 'duration',
	    epoch: 0
	});

	openmct.telemetry.addFormat({
	    key: 'nucleares-time-format',
	    name: 'Nucleares Time',

	    format(value) {
		const totalMinutes = Math.floor(value / 60000);

		const day = Math.floor(totalMinutes / 1440);
		const minuteOfDay = totalMinutes % 1440;

		const hours = Math.floor(minuteOfDay / 60);
		const minutes = minuteOfDay % 60;

		return `${day}+${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
	    },

	    parse(value) {
		if (typeof(value) == "string") {
		    const [daysPart, timePart] = value.split('+');
		    const [hours, minutes] = timePart.split(':').map(Number);
		    const days = Number(daysPart);

		    const MS_PER_MINUTE = 60 * 1000;
		    const MS_PER_HOUR = 60 * MS_PER_MINUTE;
		    const MS_PER_DAY = 24 * MS_PER_HOUR;

		    return (days * MS_PER_DAY) + (hours * MS_PER_HOUR) + (minutes * MS_PER_MINUTE);
		} else {
		    return value;
		}
	    }
	});

        var provider = {
            supportsRequest: function (domainObject) {
                return domainObject.type === 'example.telemetry';
            },
            request: function (domainObject, options) {
                var url = base_url + '/history/' +
                    domainObject.identifier.key +
                    '?start=' + options.start +
                    '&end=' + options.end;

                return http.get(url)
                    .then(function (resp) {
                        return resp.data;
                    });
            }
        };

        openmct.telemetry.addProvider(provider);

	var socket = new WebSocket(base_url.replace(/^http/, 'ws') + '/realtime/');
	openmct.time.addClock(new NuclearesClock(socket));
	openmct.telemetry.addProvider(new NuclearesRealtimeTelemetryProvider(socket));

	openmct.time.setTimeSystem('nucleares-time');
	openmct.time.setClock('nucleares-clock');
    };
};
