/**
 * @typedef {{
 *      type: string,
 *      id?: string,
 *      file?: string,
 *      height?: number,
 *      ascent?: number,
 *      chars?: string[],
 *      advances?: Object.<string, number>
 * }} Provider
 * 
 * @typedef {{
 *      image: {
 *          map: DataView,
 *          width: number,
 *          height: number
 *      },
 *      font: {
 *          bold: boolean,
 *          multiplier: number,
 *          ascent: number
 *      },
 *      char: {
 *          xPoint: number,
 *          yPoint: number,
 *          width: number,
 *          height: number
 *      }
 * }} ImageToGlyphData
 */

(async function() {
    //// The whole UI stuff
    const jarFileLabel = document.querySelector("label.jar-file");
    const jarFileLabelText = jarFileLabel.querySelector("span");
    const defaultJarFileLabelText = jarFileLabelText.innerText;
    const jarFileInput = jarFileLabel.querySelector("input");

    const extractButton = document.querySelector("button.extract");
    const buttonTooltip = extractButton.title;

    const styleLabel = document.querySelector("label.style");
    const styleCheckbox = styleLabel.querySelector("input");

    jarFileLabel.addEventListener("keypress", (event) => {
        if (event.key !== "Enter") return;
        
        jarFileInput.click();
    })
    
    jarFileInput.addEventListener("change", async (event) => {
        const file = jarFileInput.files[0];

        jarFileLabelText.innerText = file.name;
        if (!file.name.endsWith(".jar")) {
            event.preventDefault();
            // jarFileLabelText.innerText = defaultJarFileLabelText;
            disableButton();

            setTimeout(() => {
                alert("Provided file isn't a .jar file!");
            }, 0);
            return;
        }

        jarFileLabelText.innerText = file.name;
        enableButton();
    });

    styleLabel.addEventListener("keypress", (event) => {
        if (event.key !== "Enter") return;
        
        styleCheckbox.checked = !styleCheckbox.checked;
    })

    extractButton.addEventListener("click", async () => {
        const file = jarFileInput.files[0];
        if (!file) return alert("You need to choose a .jar file!");

        extractButton.classList.add("working");
        await extractFont(file, styleCheckbox.checked);
        extractButton.classList.remove("working");
    });


    
    function disableButton() {
        extractButton.disabled = true;
        extractButton.title = buttonTooltip;
    }

    function enableButton() {
        extractButton.disabled = false;
        extractButton.title = "";
    }
})();

/**
 * @param {File} jarFile
 * @param {boolean} bold
 * @param {number} multiplier
 */
async function extractFont(jarFile, bold = false, multiplier = 2) {
    console.log("Unzipping jar");

    // Reading and loading jar file
    const jarReader = new FileReader();
    jarReader.readAsArrayBuffer(jarFile);
    jarReader.addEventListener("load", async () => {
        const jar = await JSZip.loadAsync(jarReader.result);

        // Providers are defined in assets/minecraft/font/*.json files.
        // They contain a char list, some numbers, and point to the png files.
        const providers = await getProviders(jar);
        if (!providers) {
            alert("Unsupported Minecraft version!");
            return;
        }
        console.log(`Got ${providers.length} provider(s)`);

        let glyphs = {};

        // Looping through the providers, getting char glyphs and adding them to the glyph list
        for (const provider of providers) {
            const providerGlyphs = await getGlyphsFromProvider(jar, provider, bold, multiplier);
            glyphs = {...glyphs, ...providerGlyphs};
        }

        console.log(`In total ${Object.keys(glyphs).length} glyphs!`);

        
        // Creating a font, with some fancy and really understandable values -_-
        // If you don't know much about fonts, type "typography" in Google,
        // and read about ascenders, descenders and other baselines, it will help.
        // Multiplier is here, and by default set to 2, because without it,
        // these values were too low for the font to work.
        const options = {
            familyName: "Mojangles",
            styleName: bold ? "Bold" : "Normal",
            // It's like a resolution of the font, I guess?
            // With it being set to 9, like mincerafter42 did, Windows Font Viewer
            // didn't want to display the font. My guess is, it's because normally
            // fonts have set like hundrets of 'unitsPerEm', so WFV has a limit set.
            unitsPerEm: 10 * multiplier,
            // 7 because ascii characters (in Mojangles font)
            // don't go higher than 7 pixels above the base line
            ascender: 7 * multiplier,
            // -1 because ascii characters (in Mojangles font)
            // don't go lower than 1 pixel under the base line
            descender: -1 * multiplier,
            glyphs: [
                // notdef glyph required by opentype
                getNotDefGlyph(multiplier),
                ...Object.values(glyphs)
            ],
            tables: {
                os2: {
                    usWeightClass: bold ? 700 : 400
                }
            }
        };

        // console.log(options);
        const font = new opentype.Font(options);
        font.download();

        jarReader.abort();
    });
}

function getNotDefGlyph(multiplier) {
    const path = new opentype.Path();

    // Drawing a rectangle, the one that always* appeared in the chat,
    // when using emojis or other weird chars.
    // *Always for the characters that were not defined by a Mojangles font.
    path.moveTo(0, -2);
    path.lineTo(0, 7 * multiplier);
    path.lineTo(5 * multiplier, 7 * multiplier);
    path.lineTo(5 * multiplier, -2);
    path.lineTo(0, -2);

    path.moveTo(2, 0);
    path.lineTo(4 * multiplier, 0);
    path.lineTo(4 * multiplier, 6 * multiplier);
    path.lineTo(2, 6 * multiplier);
    path.lineTo(2, 0);

    return new opentype.Glyph({
        name: ".notdef",
        unicode: 0,
        advanceWidth: 6 * multiplier,
        path
    });
}

/**
 * @returns {Provider[] | null}
 */
async function getProviders(jar) {
    const packVersion = await getPackVersion(jar);
    // MC version lower than 1.13
    if (packVersion < 4) return null;
    
    const mainPath = "assets/minecraft";

    const fontDefault = jar.file(`${mainPath}/font/default.json`);
    if (!fontDefault) {
        console.log("File 'font/default.json' is missing!");
        return null;
    }

    /** @type {{ providers: Provider[] }} */
    const json = await JSON.parse(await fontDefault.async("string"));

    /** @type {Provider[]} */
    const providers = [];
    
    for (const provider of json.providers) {
        // Reference type; added in 1.20; points to another json file
        if (provider.type === "reference") {
            const {id} = provider;

            const path = id.replace("minecraft:include", `${mainPath}/font/include`) + ".json";
            const file = jar.file(path);
            if (!file) {
                console.log("Missing provider's reference file: " + path);
                continue;
            }

            /** @type {{ providers: Provider[] }} */
            const referenceJson = await JSON.parse(await file.async("string"));
            // We only want a bitmap provider.
            // And yes, if there would be a reference to a reference, this will skip it.
            // Well too bad, it's not in the latest version (1.20.4), and I don't suppose
            // it will happen soon, so it's a problem for the unknown future.
            const referenceProviders = referenceJson.providers.filter(prov => prov.type === "bitmap");
            providers.push(...referenceProviders);
            continue;
        }

        if (provider.type !== "bitmap") continue;
        providers.push(provider);
    }

    return providers;
}

/**
 * @returns {number}
 */
async function getPackVersion(jar) {
    // version.json on >= 1.14
    const versionFile = jar.file("version.json");
    if (versionFile) {
        const content = await versionFile.async("string");
        const json = await JSON.parse(content);

        const packVersion = json.pack_version;
        if (typeof packVersion === "number") return packVersion;

        return packVersion.resource;
    }

    // pack.mcmeta on 1.13 - 1.16.5
    const mcmetaFile = jar.file("pack.mcmeta");
    if (!mcmetaFile) return 0;

    const content = await mcmetaFile.async("string");
    const json = await JSON.parse(content);

    return json.pack.pack_format;
}

/**
 * @param {any} jar
 * @param {Provider} provider
 * @param {boolean} bold
 * @param {number} multiplier
 * @returns {Object.<string, opentype.Glyph>}
 */
async function getGlyphsFromProvider(jar, provider, bold, multiplier) {
    console.log(`Provider '${provider.file}'..`);

    // Reading image file
    const filePath = provider.file.replace("minecraft:font", "assets/minecraft/textures/font");
    const file = jar.file(filePath);
    const fileContent = await file.async("arraybuffer");
    
    // Getting a data view out of it
    const image = UPNG.decode(fileContent);
    const rgba8 = UPNG.toRGBA8(image)[0];
    const imageMap = new DataView(rgba8);
    
    const glyphs = {};

    const {ascent} = provider;
    const charRows = provider.chars.length;
    const charColumns = provider.chars[0].length;

    const charHeight = image.height / charRows;
    const charWidth = image.width / charColumns;


    // Looping through every character and generating it's glyph from the image
    for (let charRowIndex = 0; charRowIndex < charRows; charRowIndex++) {
        const charRow = provider.chars[charRowIndex];

        for (let charIndex = 0; charIndex < charColumns; charIndex++) {
            const char = charRow.charCodeAt(charIndex);

            if (char === 0) continue;
            if (char in glyphs) {
                console.log(`Skipping duplicate character (${char})`);
                continue;
            }


            const xPoint = charIndex * charWidth;
            const yPoint = charRowIndex * charHeight;

            const path = getCharPathFromImage({
                image: { map: imageMap, width: image.width, height: image.height },
                font: { bold, multiplier, ascent },
                char: { xPoint, yPoint, width: charWidth, height: charHeight}
            });


            // 32 is a space
            const advanceWidth = char === 32 ? 4 : path.charWidth + 2;

            const glyph = new opentype.Glyph({
                // Name of the glyph has to be ascii.
                // Or at least has to be, for the Windows Font Viewer to display the font.
                // So we set the name to the string value of the char,
                // if it's in the standard ascii table, or to the hex value of the number,
                // if it's above that.
                name: char < 256 ? String.fromCharCode(char) : char.toString(16),
                unicode: char,
                advanceWidth: advanceWidth * multiplier,
                path: path
            });
            
            glyphs[char] = glyph;
        }
    }

    return glyphs;
}


// #region By smart
/**
 * In short (I hope), we:
 * 1. convert data from the image map, to the 2D array of trues and falses
 * 2. generate the outlines of the pixels, by looping through the values in the 2D array,
 *    and checking the pixels around
 * 3. convert the outlines to the SVG moveTos and lineTos
 * @param {ImageToGlyphData} data
 * @returns {opentype.Path} character path
 */
function getCharPathFromImage(data) {
    const pixels = imageDataToMatrixArray(data);

    const {font, char} = data;
    const {multiplier, ascent} = font;
    const {height, width} = char;

    /**
     * @typedef {{
     *      side: string,
     *      from: {x: number, y: number},
     *      to: {x: number, y: number}
     * }} Line
     */
    
    /** @type {Line[]} */
    const lines = [];

    let charWidth = 0;
    // Generating outlines of the pixels
    for (let x = 0; x < pixels.length; x++) {
        for (let y = 0; y < pixels[x].length; y++) {
            const pixel = pixels[x][y];
            if (!pixel) continue;

            if (x > charWidth) charWidth = x;


            if (!checkPixelOnTheSide({x, y}, "left")) {
                lines.push({side: "left", from: {x, y}, to: {x, y: y + 1}});
            }

            if (!checkPixelOnTheSide({x, y}, "top")) {
                lines.push({side: "top", from: {x: x + 1, y}, to: {x, y}});
            }

            if (!checkPixelOnTheSide({x, y}, "right")) {
                lines.push({side: "right", from: {x: x + 1, y: y + 1}, to: {x: x + 1, y}});
            }

            if (!checkPixelOnTheSide({x, y}, "bottom")) {
                lines.push({side: "bottom", from: {x, y: y + 1}, to: {x: x + 1, y: y + 1}});
            }
        }
    }

    function checkPixelOnTheSide(pixel = {x, y}, side) {
        let {x, y} = pixel;

        if (side === "left") x--;
        else if (side === "right") x++;
        else if (side === "top") y--;
        else if (side === "bottom") y++;

        if (x < 0 || x + 1 > width) return false;
        if (y < 0 || y + 1 > height) return false;

        return pixels[x][y];
    }

    const path = new opentype.Path();
    path.charWidth = charWidth;
    // Empty character
    if (lines.length === 0) return path;
    


    //// Generating SVG path from the lines

    // Preferences of which line to choose,
    // when there are multiple, because of the corners.
    const preferences = {
        bottom: "left",
        top: "left",
        left: "bottom",
        right: "bottom"
    };

    while (lines.length > 0) {
        let currentLine = lines[0];
        const startLine = currentLine;

        moveTo(currentLine.from.x, currentLine.from.y);


        while (true) {
            const {to, side} = currentLine;
            
            const nextLine = findLine(to, preferences[side]);
            if (!nextLine) break;

            if (nextLine.side !== side) lineTo(to.x, to.y);

            deleteLine(currentLine);

            if (coordsEqual(nextLine.to, startLine.from)) {
                deleteLine(nextLine);
                break;
            }

            currentLine = nextLine;
        }
    }


    /**
     * @param {{x: number, y: number}} from
     * @returns {Line}
     */
    function findLine(from, prefered = null) {
        let match = null;

        for (const line of lines) {
            if (!coordsEqual(line.from, from)) continue;

            if (!prefered) return line;
            if (line.side === prefered) return line;

            match = line;
        }

        return match;
    }

    /**
     * @param {Line} toDelete 
     */
    function deleteLine(toDelete) {
        const lineIndex = lines.findIndex((line) => line == toDelete);
        lines.splice(lineIndex, 1);
    }

    /**
     * @param {{x: number, y: number}} coords1 
     * @param {{x: number, y: number}} coords2
     * @returns {boolean}
     */
    function coordsEqual(coords1, coords2) {
        if (coords1.x !== coords2.x) return false;
        if (coords1.y !== coords2.y) return false;

        return true;
    }

    function moveTo(x, y) {
        // Pretty straight forward, multiplying an X by a multiplier.
        x = x * multiplier;
        // Not really straight forward, multiplying a Y by a multiplier.
        // But also flipping Y upside down, because something somewhere
        // was also flipping it, I guess it was something about Path
        // and Y coordinates being the other way around, but I don't
        // really remember.
        // Aand we also subtract the difference of the char height and ascent.
        // Cause the char was too high or too low without it, also don't remember.
        y = (Math.abs(y - height) - (height - ascent)) * multiplier;

        path.moveTo(x, y);
    }

    function lineTo(x, y) {
        x = x * multiplier;
        y = (Math.abs(y - height) - (height - ascent)) * multiplier;

        path.lineTo(x, y);
    }

    
    return path;
}

/**
 * @param {ImageToGlyphData} data
 * @returns {boolean[][]}
 */
function imageDataToMatrixArray(data) {
    const {image, font, char} = data;
    const {width, height} = char;

    // Create an 2D array and fill it up
    /** @type {boolean[][]} */
    const matrix = [];
    for (let x = 0; x < width; x++) matrix[x] = new Array(height).fill(false);
    
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const imageX = char.xPoint + x;
            const imageY = char.yPoint + y;
            
            const pixelIndex = (imageY * image.width) + imageX;
            // Image map has 4 bytes for each pixel, RGB + Alpha.
            // And since we need only alpha, because font images are
            // all full white, and only alpha changes, we jump by 4 bytes,
            // for each pixel, and then add 3, to get only alpha value.
            const pixel = image.map.getUint8((pixelIndex * 4) + 3);

            if (pixel !== 255) continue;

            matrix[x][y] = true;
            // If font is bold, set a pixel on the right also to true.
            // Cause all what Minecraft does, is duplicating a char
            // and putting it with 1 pixel offset.
            if (font.bold && x + 1 < width) matrix[x + 1][y] = true;
        }
    }

    return matrix;
}