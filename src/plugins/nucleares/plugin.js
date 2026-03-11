// ex: sw=4

import http from './http.js';

const baseUrl = 'http://localhost:8081';
let dictionaryPromise;

function getDictionary() {
    if (!dictionaryPromise) {
	dictionaryPromise = http.get(baseUrl + '/dictionary.json')
	    .then(result => result.data)
            .catch(err => {
                dictionaryPromise = undefined;
                throw err;
            });
    }

    return dictionaryPromise;
}

var objectProvider = {
    get: function (identifier) {
        return getDictionary().then(function (dictionary) {
	    var rval;
            if (identifier.key === 'facility') {
                rval = {
                    identifier: identifier,
                    name: dictionary.name,
                    type: 'folder',
                    location: 'ROOT'
                };
            } else {
                var measurement = dictionary.measurements.filter(function (m) {
                    return m.key === identifier.key;
                })[0];
                rval = {
                    identifier: identifier,
                    name: measurement.name,
                    type: 'nucleares.telemetry',
                    telemetry: {
                        values: measurement.values
                    },
                    location: 'nucleares.taxonomy:facility'
                };
            }
	    console.log([identifier, rval]);
	    return rval;
        });
    }
};

var compositionProvider = {
    appliesTo: function (domainObject) {
        return domainObject.identifier.namespace === 'nucleares.taxonomy' &&
               domainObject.type === 'folder';
    },
    load: function (domainObject) {
        return getDictionary()
            .then(function (dictionary) {
                return dictionary.measurements.map(function (m) {
                    return {
                        namespace: 'nucleares.taxonomy',
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
	    return domainObject.type === 'nucleares.telemetry';
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
            namespace: 'nucleares.taxonomy',
            key: 'facility'
        });

        openmct.objects.addProvider('nucleares.taxonomy', objectProvider);

        openmct.composition.addProvider(compositionProvider);

        openmct.types.addType('nucleares.telemetry', {
            name: 'Example Telemetry Point',
            description: 'Example telemetry point from our happy tutorial.',
            cssClass: 'icon-telemetry'
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

	openmct.time.addTimeSystem({
	    key: 'nucleares-time',
	    name: 'Reactor Time',
	    timeFormat: 'nucleares-time-format',
	    durationFormat: 'duration',
	    epoch: 0
	});

        var provider = {
            supportsRequest: function (domainObject) {
                return domainObject.type === 'nucleares.telemetry';
            },
            request: function (domainObject, options) {
                var url = baseUrl + '/history/' +
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

	var socket = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/realtime/');
	openmct.time.addClock(new NuclearesClock(socket));
	openmct.telemetry.addProvider(new NuclearesRealtimeTelemetryProvider(socket));

	openmct.time.setTimeSystem('nucleares-time');
	openmct.time.setClock('nucleares-clock');
    };
};
