/* Multi-level call chain teaching sample: main -> outer -> middle -> inner.
 * Three real frames on the stack at once, each with a frame pointer, so the
 * stack map draws a verified chain of caller frames. */
#include <stdio.h>

__attribute__((noinline))
static int inner(int v) {
    volatile int adjusted = v * 2 + 1;
    return adjusted;
}

__attribute__((noinline))
static int middle(int v) {
    volatile int offset = 100;
    return inner(v + offset);
}

__attribute__((noinline))
static int outer(int v) {
    volatile int base = 1000;
    return middle(v + base);
}

int main(void) {
    volatile int seed = 7;
    int result = outer(seed);
    printf("result = %d\n", result);
    return 0;
}
