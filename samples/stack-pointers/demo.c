/* Pointer-routing teaching sample: ten real pointer variables covering every
 * visual case — several targets inside the frame, two pointers to the SAME
 * target, a NULL pointer, and pointers OUTSIDE the stack window (a global and
 * a string literal). GDB resolves each via DWARF; the stack map routes one
 * orthogonal lane per visible relation. */
#include <stdio.h>

int global_counter = 42; /* outside the stack window */

__attribute__((noinline))
static void touch_all(int *const *sink) {
    /* keep every pointer alive so GDB reports real targets */
    (void)sink;
}

int main(void) {
    volatile int a = 11;
    volatile int b = 22;
    volatile int c = 33;
    volatile long base = 44;

    volatile int *p1 = &a;
    volatile int *p2 = &b;
    volatile int *p3 = &c;
    volatile long *p4 = &base;
    volatile int *p5 = &a;          /* same target as p1 */
    volatile int *p6 = &b;          /* same target as p2 */
    volatile int *p7 = NULL;        /* null pointer, not routed */
    volatile int *p8 = &global_counter;    /* outside the stack window */
    const char *p9 = "teaching";    /* outside the stack window (.rodata) */
    volatile int *p10 = &a;         /* third pointer to the same target */

    volatile int *const sink = p1;
    touch_all((int *const *)&sink);
    printf("%d %d %d %ld %d %d %p %p %s\n",
           *p1, *p2, *p3, *p4, *p5, *p6, (void *)p8, (void *)p9, p9);
    return 0;
}
