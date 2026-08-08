import os
import sys
import torch
import time
import traceback

def test_cuda_support():
    """Comprehensive test of CUDA support for diarization"""
    print("\n" + "="*50)
    print("CUDA SUPPORT TEST FOR DIARIZATION")
    print("="*50)
    
    # 1. Basic PyTorch and CUDA information
    print("\n[1] SYSTEM INFORMATION:")
    print(f"• Python version: {sys.version}")
    print(f"• PyTorch version: {torch.__version__}")
    print(f"• CUDA available: {torch.cuda.is_available()}")
    
    if not torch.cuda.is_available():
        print("\n❌ CUDA IS NOT AVAILABLE")
        print("Possible reasons:")
        print("  • PyTorch was installed without CUDA support")
        print("  • NVIDIA drivers are not properly installed")
        print("  • Your GPU is not CUDA-compatible")
        print("  • CUDA toolkit is not installed or not in PATH")
        return False
    
    # 2. Detailed GPU information
    print("\n[2] GPU INFORMATION:")
    try:
        print(f"• CUDA version: {torch.version.cuda}")
        device_count = torch.cuda.device_count()
        print(f"• GPU count: {device_count}")
        
        for i in range(device_count):
            print(f"\nGPU #{i}:")
            print(f"  • Name: {torch.cuda.get_device_name(i)}")
            print(f"  • Capability: {torch.cuda.get_device_capability(i)}")
            
            # Get memory information
            total_mem = torch.cuda.get_device_properties(i).total_memory / 1024**2
            allocated_mem = torch.cuda.memory_allocated(i) / 1024**2
            reserved_mem = torch.cuda.memory_reserved(i) / 1024**2
            free_mem = total_mem - allocated_mem
            
            print(f"  • Total memory: {total_mem:.0f} MB")
            print(f"  • Allocated memory: {allocated_mem:.0f} MB")
            print(f"  • Reserved memory: {reserved_mem:.0f} MB")
            print(f"  • Free memory: {free_mem:.0f} MB")
    except Exception as e:
        print(f"Error getting GPU details: {e}")
    
    # 3. Test basic GPU operations
    print("\n[3] TESTING BASIC GPU OPERATIONS:")
    try:
        # Tensor creation
        print("• Creating tensor on GPU...", end="")
        start_time = time.time()
        a = torch.tensor([1.0, 2.0, 3.0], device='cuda')
        print(f" ✓ ({time.time() - start_time:.4f}s)")
        
        # Basic operations
        print("• Performing calculations...", end="")
        start_time = time.time()
        b = a * 2
        torch.cuda.synchronize()  # Make sure operation is complete
        print(f" ✓ ({time.time() - start_time:.4f}s)")
        print(f"  Result: {a} * 2 = {b}")
        
        # Memory management
        print("• Testing memory management...", end="")
        start_time = time.time()
        large_tensor = torch.zeros((1000, 1000), device='cuda')
        del large_tensor
        torch.cuda.empty_cache()
        print(f" ✓ ({time.time() - start_time:.4f}s)")
        
    except Exception as e:
        print(f"\n❌ GPU operations failed: {e}")
        traceback.print_exc()
        return False
    
    # 4. Test loading a small model
    print("\n[4] TESTING MODEL LOADING:")
    try:
        print("• Loading a small test model...", end="")
        start_time = time.time()
        
        # Create a simple model
        model = torch.nn.Sequential(
            torch.nn.Linear(10, 100),
            torch.nn.ReLU(),
            torch.nn.Linear(100, 1)
        ).to('cuda')
        
        # Test forward pass
        input_data = torch.rand(5, 10, device='cuda')
        output = model(input_data)
        
        torch.cuda.synchronize()
        print(f" ✓ ({time.time() - start_time:.4f}s)")
        print(f"  Model output shape: {output.shape}")
        
    except Exception as e:
        print(f"\n❌ Model loading failed: {e}")
        traceback.print_exc()
        return False
    
    # 5. Test Mixed Precision if available
    print("\n[5] TESTING MIXED PRECISION (if available):")
    if hasattr(torch.cuda, 'amp'):
        try:
            print("• Testing mixed precision...", end="")
            start_time = time.time()
            
            with torch.cuda.amp.autocast():
                # Create a model
                model = torch.nn.Sequential(
                    torch.nn.Linear(10, 100),
                    torch.nn.ReLU(),
                    torch.nn.Linear(100, 1)
                ).to('cuda')
                
                # Test forward pass
                input_data = torch.rand(5, 10, device='cuda')
                output = model(input_data)
            
            torch.cuda.synchronize()
            print(f" ✓ ({time.time() - start_time:.4f}s)")
            print("  Mixed precision is working properly")
            
        except Exception as e:
            print(f"\n⚠️ Mixed precision test failed: {e}")
            print("  This may affect performance but is not critical")
    else:
        print("• Mixed precision not available in this PyTorch version")
    
    # 6. Overall verdict
    print("\n[6] OVERALL VERDICT:")
    print("✅ CUDA IS WORKING PROPERLY")
    print("Your system should be able to use GPU acceleration for diarization.")
    
    return True

if __name__ == "__main__":
    # Clear CUDA cache before testing
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    test_cuda_support() 