const fileInput = document.getElementById('fileInput');
const fileTree = document.getElementById('fileTree');
const fileContent = document.getElementById('fileContent');
const plot = document.getElementById('plot');
const resizer = document.getElementById('resizer');
const fileListContainer = document.getElementById('fileListContainer');
const plotContainer = document.getElementById('plotContainer');
const resultList = document.getElementById('resultList');

let currentPath = [];
let fileSystem = {};
let lastCSVData = null; // To store the last loaded CSV data
let peaksShown = {}; // To keep track of which peaks are shown

fileInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files);
    fileSystem = buildFileTree(files);
    currentPath = [];
    renderFileTree(fileSystem, currentPath);
});

function buildFileTree(files) {
    const root = {};
    files.forEach(file => {
        const parts = file.webkitRelativePath.split('/');
        let current = root;
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = index === parts.length - 1 ? file : {};
            }
            current = current[part];
        });
    });
    return root;
}

function renderFileTree(tree, path) {
    fileTree.innerHTML = '';

    let currentFolder = tree;
    path.forEach(folder => {
        currentFolder = currentFolder[folder];
    });

    if (path.length > 0) {
        const backItem = document.createElement('div');
        backItem.textContent = '..';
        backItem.classList.add('back', 'cursor-pointer', 'my-1', 'p-1', 'rounded');
        backItem.addEventListener('click', () => {
            path.pop();
            renderFileTree(tree, path);
            plot.innerHTML = '';  // Clear the plot
            fileContent.classList.add('hidden');  // Hide the file content
        });
        fileTree.appendChild(backItem);
    }

    Object.keys(currentFolder).forEach(key => {
        const item = document.createElement('div');
        if (currentFolder[key] instanceof File) {
            item.textContent = key;
            item.classList.add('file', 'cursor-pointer', 'my-1', 'p-1', 'rounded');
            item.addEventListener('click', () => {
                const file = currentFolder[key];
                if (file.name.endsWith('.csv')) {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        lastCSVData = e.target.result;
                        plotRawCSV(lastCSVData);
                        const preprocessedData = preprocessCSV(lastCSVData);
                        await runModel(preprocessedData);
                    };
                    reader.readAsText(file);
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        fileContent.textContent = e.target.result;
                        fileContent.classList.remove('hidden');
                        plot.innerHTML = '';  // Clear the plot
                    };
                    reader.readAsText(file);
                }
            });
        } else {
            item.textContent = key;
            item.classList.add('folder', 'cursor-pointer', 'my-1', 'p-1', 'rounded');
            item.addEventListener('click', () => {
                path.push(key);
                renderFileTree(tree, path);
                plot.innerHTML = '';  // Clear the plot
                fileContent.classList.add('hidden');  // Hide the file content
            });
        }
        fileTree.appendChild(item);
    });
}

function preprocess(intensities, masses, binResolution = 0.5) {
    const bins = [];
    for (let i = 899.9; i < 3500; i += binResolution) {
        bins.push(i);
    }
    const binCount = bins.length;
    const binSums = new Array(binCount).fill(0);
    const binCounts = new Array(binCount).fill(0);

    const binIndices = masses.map(mass => bins.findIndex(bin => mass < bin));

    for (let i = 0; i < binIndices.length; i++) {
        const binIndex = binIndices[i] - 1; // Adjusting for 0-based index
        if (binIndex >= 0 && binIndex < binCount) {
            binSums[binIndex] += intensities[i];
            binCounts[binIndex] += 1;
        }
    }

    const binMeans = binSums.map((sum, index) => binCounts[index] !== 0 ? sum / binCounts[index] : 0);

    // Normalize the results
    const mean = binMeans.reduce((acc, val) => acc + val, 0) / binMeans.length;
    const std = Math.sqrt(binMeans.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / binMeans.length);
    const normalizedMeans = binMeans.map(val => (val - mean) / (std + Number.EPSILON));

    // Calculate the preprocessed mass axis (midpoints of bins)
    const binMidpoints = bins.map((bin, index) => index < binCount - 1 ? (bins[index] + bins[index + 1]) / 2 : null).slice(0, -1);

    return { normalizedMeans, binMidpoints };
}

function plotRawCSV(data) {
    const rows = data.split('\n').slice(1).map(row => row.split(',').map(Number));
    const mass = rows.map(row => row[0]);
    const intensity = rows.map(row => row[1]);

    const trace = {
        x: mass,
        y: intensity,
        mode: 'lines',
        type: 'scatter'
    };

    const layout = {
        title: 'Mass spectrometry data',
        xaxis: { title: 'Mass' },
        yaxis: { title: 'Intensity' }
    };

    Plotly.newPlot('plot', [trace], layout);
}

function preprocessCSV(data) {
    const rows = data.split('\n').slice(1).map(row => row.split(',').map(Number));
    const mass = rows.map(row => row[0]);
    const intensity = rows.map(row => row[1]);

    const result = preprocess(intensity, mass);
    return result.normalizedMeans;
}

async function runModel(data) {
    const response = await fetch('/run_model', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data })
    });
    const results = await response.json();
    displayResults(results);
}

const colors = [
    '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
];

function displayResults(results) {
    resultList.innerHTML = ''; // Clear the previous results
    // clear peaksShown
    for (let key in peaksShown) {
        if (peaksShown.hasOwnProperty(key)) {
            delete peaksShown[key];
        }
    }
    results.forEach((result, index) => {
        const item = document.createElement('button');
        item.textContent = `${result.name}: ${result.score.toFixed(4)}`;
        item.classList.add('result-item', 'p-2', 'border', 'rounded', 'mb-2', 'bg-gray-200', 'hover:bg-gray-300', 'cursor-pointer');
        item.dataset.index = index; // Store the index in a data attribute for easy access
        item.addEventListener('click', () => togglePeaks(result, index, item));
        resultList.appendChild(item);
    });
}

function togglePeaks(result, index, button) {
    const peakId = `peaks-${result.id}`;
    const plotId = 'plot'; // assuming the id of your plot is 'plot'

    if (peaksShown[peakId]) {
        // Remove the peaks
        const remainingShapes = Object.keys(peaksShown)
            .filter(id => id !== peakId)
            .reduce((acc, id) => acc.concat(peaksShown[id]), []);

        const update = {
            'shapes': remainingShapes
        };

        Plotly.relayout(plotId, update);

        delete peaksShown[peakId];
        button.style.backgroundColor = ''; // Reset button color
    } else {
        // Show the peaks
        const color = colors[index % colors.length]; // Get the color from the colormap
        const peakLines = result.peaks.map(peak => ({
            type: 'line',
            x0: peak,
            x1: peak,
            y0: 0,
            y1: 1,
            yref: 'paper', // use 'paper' to make sure it covers the full y-axis
            line: {
                color: color, // Set the color of the line
                width: 1
            }
        }));

        // Merge new peaks with existing ones
        const existingShapes = Object.values(peaksShown).flat();
        const newShapes = existingShapes.concat(peakLines);

        const update = {
            'shapes': newShapes
        };

        Plotly.relayout(plotId, update);
        peaksShown[peakId] = peakLines;
        button.style.backgroundColor = color; // Set button color
    }
}

// Draggable resizer
resizer.addEventListener('mousedown', function(e) {
    e.preventDefault();
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);
});

function resize(e) {
    const fileListWidth = e.clientX;
    const plotWidth = window.innerWidth - fileListWidth - resizer.offsetWidth;

    if (fileListWidth > 50 && plotWidth > 50) { // Ensure minimum widths for both containers
        fileListContainer.style.width = fileListWidth + 'px';
        plotContainer.style.width = plotWidth + 'px';
    }
}

function stopResize() {
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResize);
}
