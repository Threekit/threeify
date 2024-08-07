#pragma once
#pragma include <math/sampling/random>

// based on https://www.shadertoy.com/view/MslGR8
vec3 dithering( vec3 color ) {
    //Calculate grid position
    float grid_position = rand( gl_FragCoord.xy );

    //Shift the individual colors differently, thus making it even harder to see the dithering pattern
    vec3 dither_shift_RGB = vec3( 0.25 / 255., -0.25 / 255., 0.25 / 255. );

    //modify shift acording to grid position.
    dither_shift_RGB = mix( 2. * dither_shift_RGB, -2. * dither_shift_RGB, grid_position );

    //shift the color by dither_shift
    return color + dither_shift_RGB;
}
