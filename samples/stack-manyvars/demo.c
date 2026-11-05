/* Dense-locals teaching sample: twelve locals of mixed real sizes (char,
 * short, int, long, array) in one frame, so the map exercises the micro-block
 * external labels, the compact rows and the pointer lane at once. */
#include <stdio.h>

__attribute__((noinline))
static long mix_all(void) {
    volatile char  tag      = 'Z';
    volatile char  small2   = 7;
    volatile short counter  = 300;
    volatile short delta    = -12;
    volatile int   total    = 123456;
    volatile int   limit    = -1;
    volatile unsigned flags = 0xF0F0;
    volatile long   offset  = 1234567890L;
    volatile long   big     = -987654321L;
    volatile int    rgb[3]  = { 0x11, 0x22, 0x33 };
    volatile int   *tracker = &total;
    volatile short  check   = 4;

    volatile long acc = offset + big + counter + total + flags + check
                      + tag + small2 + delta + limit + rgb[0] + rgb[1] + rgb[2];
    printf("%ld %p\n", acc, (void *)tracker);
    return acc;
}

int main(void) {
    volatile int launched = 1;
    long result = mix_all();
    printf("result = %ld\n", result);
    return 0;
}
