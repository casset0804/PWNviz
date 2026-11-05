#include <stdio.h>

/*
 * Pointer teaching sample.
 *
 * `p` and `q` really point at the local variables `a` and `b`; `n` is a real
 * NULL pointer. PWNviz only draws a pointer arrow when the pointer value equals
 * the target variable's DWARF address exactly, so the arrows here are evidence,
 * not a heuristic.
 */
int show_pointers(void) {
    int a = 10;
    int b = 20;
    int *p = &a;
    int *q = &b;
    int *n = NULL;

    printf("a=%d b=%d *p=%d *q=%d\n", a, b, *p, *q);
    n = p;
    return *p + *q;
}

int main(void) {
    int result = show_pointers();
    printf("result = %d\n", result);
    return 0;
}
